import { classifyTask, TaskType } from "./task-classifier.js";
import { routingLog } from "./logger.js";
import { scoreComplexity, ComplexityTier } from "./complexity-scorer.js";
import { detectOverride, OverrideResult } from "./override-detector.js";
import { selectCandidates, SelectionResult } from "./priority-selector.js";
import { UserProvider, IgniteConfig } from "./user-providers.js";
import { RoutingTimer, type RoutingOverhead } from "./cost-estimator.js";

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
  selection?: SelectionResult;
  candidateProviders: UserProvider[];
  error?: string;
  latencyMs: number;
  routingOverhead?: RoutingOverhead;
  tierConfigs?: Record<string, any>;
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

export async function route(
  context: RoutingContext,
  config: IgniteConfig,
): Promise<RoutingDecision> {
  const timer = new RoutingTimer();
  const startTime = Date.now();
  routingLog.debug("Routing decision started", {
    model: context.requestedModel,
    tokens: context.estimatedTokens,
  });

  const override = detectOverride(context.messages, context.requestedModel, config.providers);

  if (override.detected) {
    if (override.notConfigured) {
      return {
        override,
        candidateProviders: [],
        error: `Model '${override.modelId}' is not configured in IgniteRouter. Add it to your provider list or use igniterouter/auto for automatic routing.`,
        latencyMs: Date.now() - startTime,
      };
    }

    const matchedProvider = config.providers.find(
      (p) => p.id.toLowerCase() === override.modelId!.toLowerCase(),
    );

    if (!matchedProvider) {
      return {
        override,
        candidateProviders: [],
        error: `Model '${override.modelId}' is not configured in IgniteRouter. Add it to your provider list or use igniterouter/auto for automatic routing.`,
        latencyMs: Date.now() - startTime,
      };
    }

    routingLog.info("Override detected", { model: override.modelId, source: override.source });

    return {
      override,
      candidateProviders: [matchedProvider],
      latencyMs: Date.now() - startTime,
    };
  }

  const taskResult = classifyTask(context.messages, context.tools);
  const taskType = taskResult.taskType;
  timer.mark("task");
  routingLog.debug("Task classified", {
    taskType,
    confidence: taskResult.confidence,
    reason: taskResult.reason,
  });

  const complexityResult = await scoreComplexity(
    typeof context.messages[context.messages.length - 1]?.content === "string"
      ? (context.messages[context.messages.length - 1].content as string)
      : "",
  );
  timer.mark("complexity");
  routingLog.debug("Complexity scored", {
    score: complexityResult.score,
    tier: complexityResult.tier,
    method: complexityResult.method,
    latencyMs: complexityResult.latencyMs,
  });

  // Log for OpenClaw
  routingLog.info("[IgniteRouter] Task analysis complete", {
    taskType,
    complexityScore: complexityResult.score,
    tier: complexityResult.tier,
    scoringMethod: complexityResult.method,
  });

  const hasImages = detectImages(context.messages);
  const hasTools = Array.isArray(context.tools) && context.tools.length > 0;
  const needsStreaming = context.needsStreaming ?? false;
  const estimatedTokens = context.estimatedTokens ?? estimateTokens(context.messages);

  const selection = selectCandidates(
    config.providers,
    complexityResult.tier,
    taskType,
    config.defaultPriority,
    { hasImages, hasTools, needsStreaming, estimatedTokens },
  );
  timer.mark("selection");

  routingLog.info("[IgniteRouter] Candidates selected", {
    tier: complexityResult.tier,
    count: selection.candidates.length,
    filtered: selection.filtered.length,
    topModel: selection.candidates[0]?.provider.id ?? "none",
    topTier: selection.candidates[0]?.provider.tier ?? "none",
  });

  if (selection.candidates.length === 0) {
    routingLog.warn("No candidates after filtering", {
      filtered: selection.filtered.map((p) => p.id),
    });
    const filteredReasons = Array.from(selection.filterReasons.entries())
      .map(([id, reason]) => `  ${id}: ${reason}`)
      .join("\n");

    return {
      taskType,
      tier: complexityResult.tier,
      complexityScore: complexityResult.score,
      selection,
      candidateProviders: [],
      error: `No capable providers available:\n${filteredReasons}`,
      latencyMs: Date.now() - startTime,
    };
  }

  const overhead = timer.getOverhead();

  return {
    taskType,
    tier: complexityResult.tier,
    complexityScore: complexityResult.score,
    selection,
    candidateProviders: selection.candidates.map((c) => c.provider),
    latencyMs: overhead.totalRoutingMs,
    routingOverhead: overhead,
  };
}
