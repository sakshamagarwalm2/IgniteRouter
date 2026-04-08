/**
 * IgniteRouter - ClawRouter-Style Routing Engine
 *
 * This module uses the routing-config.ts for tier-based model selection.
 * Each tier has a PRIMARY model + FALLBACK chain defined in the config.
 * We verify models exist in OpenClaw config before returning them.
 */

import { classifyTask, TaskType } from "./task-classifier.js";
import { routingLog } from "./logger.js";
import { scoreComplexity, ComplexityTier } from "./complexity-scorer.js";
import { detectOverride, OverrideResult } from "./override-detector.js";
import { IgniteConfig, IgniteProvider } from "./openclaw-providers.js";
import { RoutingTimer } from "./cost-estimator.js";
import {
  DEFAULT_ROUTING_CONFIG,
  getTierConfig,
  applyPromotions,
  type TierConfig,
  type RoutingProfile,
} from "./router/routing-config.js";

export interface RoutingContext {
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  requestedModel?: string;
  estimatedTokens?: number;
  needsStreaming?: boolean;
}

export interface RoutingDecision {
  override?: OverrideResult;
  taskType?: TaskType;
  tier?: ComplexityTier;
  complexityScore?: number;
  recommendedModel?: string;
  candidateModels: string[];
  profile: RoutingProfile;
  error?: string;
  latencyMs: number;
}

function detectImages(messages: Array<{ role: string; content: unknown }>): boolean {
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object" && "type" in part) {
            const partObj = part as { type: string };
            if (partObj.type === "image_url" || partObj.type === "image") {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function estimateTokens(messages: Array<{ role: string; content: unknown }>): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === "string") {
          totalChars += part.length;
        }
      }
    }
  }
  return Math.ceil(totalChars / 4);
}

function checkModelCapability(
  modelId: string,
  capability: "vision" | "tools" | "streaming",
  provider: IgniteProvider,
): boolean {
  switch (capability) {
    case "vision":
      return provider.supportsVision;
    case "tools":
      return provider.supportsTools;
    case "streaming":
      return provider.supportsStreaming;
  }
}

function findAvailableModel(
  modelId: string,
  providers: IgniteProvider[],
  hasImages: boolean,
  hasTools: boolean,
): IgniteProvider | null {
  const provider = providers.find((p) => p.id === modelId);
  if (!provider) return null;

  if (hasImages && !provider.supportsVision) return null;
  if (hasTools && !provider.supportsTools) return null;

  return provider;
}

function buildCandidateChain(
  tierConfig: TierConfig,
  providers: IgniteProvider[],
  hasImages: boolean,
  hasTools: boolean,
  estimatedTokens: number,
): string[] {
  const candidates: string[] = [];
  const allCandidates = [tierConfig.primary, ...tierConfig.fallback];

  for (const modelId of allCandidates) {
    const provider = findAvailableModel(modelId, providers, hasImages, hasTools);

    if (!provider) {
      routingLog.debug("Model not available or filtered", { model: modelId });
      continue;
    }

    if (provider.contextWindow && estimatedTokens > provider.contextWindow * 0.9) {
      routingLog.debug("Model context window too small", {
        model: modelId,
        needed: estimatedTokens,
        has: provider.contextWindow,
      });
      continue;
    }

    candidates.push(modelId);
  }

  return candidates;
}

export async function route(
  context: RoutingContext,
  config: IgniteConfig,
  profile: RoutingProfile = "auto",
): Promise<RoutingDecision> {
  const startTime = Date.now();
  const timer = new RoutingTimer();

  routingLog.debug("Routing decision started", {
    model: context.requestedModel,
    tokens: context.estimatedTokens,
  });

  const providers = config.providers;
  const hasImages = detectImages(context.messages);
  const hasTools = Array.isArray(context.tools) && context.tools.length > 0;
  const estimatedTokens = context.estimatedTokens ?? estimateTokens(context.messages);
  const routingConfig = DEFAULT_ROUTING_CONFIG;

  const override = detectOverride(context.messages, context.requestedModel, providers);

  if (override.detected) {
    if (override.notConfigured) {
      return {
        override,
        candidateModels: [],
        profile,
        error: `Model '${override.modelId}' is not configured in IgniteRouter. Add it to your provider list.`,
        latencyMs: Date.now() - startTime,
      };
    }

    routingLog.info("Override detected", { model: override.modelId, source: override.source });

    const provider = providers.find((p) => p.id.toLowerCase() === override.modelId!.toLowerCase());

    if (!provider) {
      return {
        override,
        candidateModels: [],
        profile,
        error: `Model '${override.modelId}' not found in OpenClaw config.`,
        latencyMs: Date.now() - startTime,
      };
    }

    return {
      override,
      recommendedModel: provider.id,
      candidateModels: [provider.id],
      profile,
      latencyMs: Date.now() - startTime,
    };
  }

  const taskResult = classifyTask(context.messages, context.tools);
  const taskType = taskResult.taskType;
  timer.mark("task");

  const complexityResult = await scoreComplexity(
    typeof context.messages[context.messages.length - 1]?.content === "string"
      ? (context.messages[context.messages.length - 1].content as string)
      : "",
  );
  timer.mark("complexity");

  routingLog.info("[IgniteRouter] Task analysis complete", {
    taskType,
    complexityScore: complexityResult.score,
    tier: complexityResult.tier,
    scoringMethod: complexityResult.method,
  });

  let tier = complexityResult.tier;

  if (estimatedTokens > routingConfig.scoring.maxTokensForceComplex) {
    routingLog.info("Forcing COMPLEX tier due to large context", {
      tokens: estimatedTokens,
      threshold: routingConfig.scoring.maxTokensForceComplex,
    });
    tier = ComplexityTier.Complex;
  }

  const tierConfigs = getTierConfig(profile, routingConfig);
  const finalTierConfigs = applyPromotions(tierConfigs, routingConfig, profile);

  const tierConfig = finalTierConfigs[tier];

  if (!tierConfig) {
    return {
      taskType,
      tier,
      complexityScore: complexityResult.score,
      candidateModels: [],
      profile,
      error: `No tier config found for tier: ${tier}`,
      latencyMs: Date.now() - startTime,
    };
  }

  const candidates = buildCandidateChain(
    tierConfig,
    providers,
    hasImages,
    hasTools,
    estimatedTokens,
  );

  if (candidates.length === 0) {
    routingLog.warn("No candidates available for tier", { tier, hasImages, hasTools });

    return {
      taskType,
      tier,
      complexityScore: complexityResult.score,
      candidateModels: [],
      profile,
      error: `No models available for ${tier} tier with required capabilities (vision: ${hasImages}, tools: ${hasTools}). Please add models to your OpenClaw config.`,
      latencyMs: Date.now() - startTime,
    };
  }

  const recommendedModel = candidates[0];
  const overhead = timer.getOverhead();

  routingLog.info("[IgniteRouter] Model selected", {
    tier,
    profile,
    recommendedModel,
    candidates: candidates.length,
    latencyMs: overhead.totalRoutingMs,
  });

  return {
    taskType,
    tier,
    complexityScore: complexityResult.score,
    recommendedModel,
    candidateModels: candidates,
    profile,
    latencyMs: overhead.totalRoutingMs,
  };
}
