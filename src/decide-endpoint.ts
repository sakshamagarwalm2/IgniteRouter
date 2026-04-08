/**
 * Decide Endpoint Handler - ClawRouter-Style
 *
 * Uses the new routing engine that follows ClawRouter's approach:
 * - Tier configs with primary + fallback chains
 * - Profiles (auto, eco, premium, agentic)
 * - Promotions support
 */

import {
  route as routeV2,
  type RoutingContext,
  type RoutingDecision,
} from "./routing-engine-v2.js";
import { IgniteConfig } from "./openclaw-providers.js";
import { logger } from "./logger.js";
import { ComplexityTier } from "./complexity-scorer.js";

const log = logger.child("decide");

export interface DecideRequest {
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  profile?: "auto" | "eco" | "premium" | "agentic";
}

export interface DecideResponse {
  recommendedModel: string;
  tier: string;
  taskType: string;
  complexityScore: number;
  reasoning: string;
  profile: string;
  alternatives: string[];
  capabilities: {
    supportsVision: boolean;
    supportsTools: boolean;
    supportsStreaming: boolean;
    contextWindow: number;
  };
  routingLatencyMs: number;
  error?: string;
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

export async function handleDecideRequest(
  body: DecideRequest,
  config: IgniteConfig,
  openclawLogger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  },
): Promise<DecideResponse> {
  const startTime = Date.now();

  const apiLog = openclawLogger || log;

  apiLog.info("[IgniteRouter] Decision request received", {
    messageCount: body.messages?.length ?? 0,
    hasTools: !!body.tools,
    requestedModel: body.model,
    profile: body.profile || "auto",
  });

  const hasImages = detectImages(body.messages);
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const estimatedTokens = estimateTokens(body.messages);

  const context: RoutingContext = {
    messages: body.messages,
    tools: body.tools,
    requestedModel: body.model,
    estimatedTokens,
    needsStreaming: body.stream ?? false,
  };

  const profile = body.profile || "auto";
  const decision = await routeV2(context, config, profile);

  const routingLatencyMs = Date.now() - startTime;

  if (decision.error || !decision.recommendedModel) {
    log.error("Routing error", { error: decision.error });
    return {
      recommendedModel: "",
      tier: decision.tier ?? "UNKNOWN",
      taskType: decision.taskType ?? "UNKNOWN",
      complexityScore: decision.complexityScore ?? 0,
      reasoning: decision.error || "No model selected",
      profile: decision.profile,
      alternatives: [],
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        contextWindow: 0,
      },
      routingLatencyMs,
      error: decision.error,
    };
  }

  const recommendedModel = decision.recommendedModel;
  const alternatives = decision.candidateModels.slice(1, 4);

  const provider = config.providers.find((p) => p.id === recommendedModel);
  const capabilities = provider
    ? {
        supportsVision: provider.supportsVision,
        supportsTools: provider.supportsTools,
        supportsStreaming: provider.supportsStreaming,
        contextWindow: provider.contextWindow,
      }
    : {
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        contextWindow: 0,
      };

  let reasoning = "";
  if (decision.override?.detected) {
    reasoning = `Override: using ${recommendedModel}`;
  } else {
    reasoning = `${decision.taskType} task, ${decision.tier} tier selected (${profile} profile)`;
    if (hasTools) reasoning += ", tool-capable model";
    if (hasImages) reasoning += ", vision-capable model";
  }

  apiLog.info("[IgniteRouter] Decision made", {
    model: recommendedModel,
    tier: decision.tier,
    taskType: decision.taskType,
    complexityScore: decision.complexityScore,
    profile: decision.profile,
    latencyMs: routingLatencyMs,
  });

  if (apiLog.debug) {
    apiLog.debug("[IgniteRouter] Alternative models available", {
      alternatives,
    });
  }

  return {
    recommendedModel,
    tier: decision.tier ?? "UNKNOWN",
    taskType: decision.taskType ?? "UNKNOWN",
    complexityScore: decision.complexityScore ?? 0,
    reasoning,
    profile: decision.profile,
    alternatives,
    capabilities,
    routingLatencyMs,
  };
}

export function createDecideHandler(config: IgniteConfig) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST /v1/decide" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = (await req.json()) as DecideRequest;

      if (!body.messages || !Array.isArray(body.messages)) {
        return new Response(JSON.stringify({ error: "Missing or invalid 'messages' array" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const decision = await handleDecideRequest(body, config);

      return new Response(JSON.stringify(decision), {
        status: decision.error ? 400 : 200,
        headers: {
          "Content-Type": "application/json",
          "X-IgniteRouter-Latency": `${decision.routingLatencyMs}ms`,
        },
      });
    } catch (err) {
      log.error("Request parsing error", { error: String(err) });
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
