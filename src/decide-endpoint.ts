import { route, RoutingContext, RoutingDecision } from "./routing-engine.js";
import { IgniteConfig, UserProvider } from "./user-providers.js";
import { logger } from "./logger.js";

const log = logger.child("decide");

export interface DecideRequest {
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  model?: string;
  max_tokens?: number;
  stream?: boolean;
}

export interface DecideResponse {
  recommendedModel: string;
  tier: string;
  taskType: string;
  complexityScore: number;
  reasoning: string;
  alternatives: Array<{
    model: string;
    tier: string;
    providerName: string;
  }>;
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
): Promise<DecideResponse> {
  const startTime = Date.now();

  log.info("Decision request received", {
    messageCount: body.messages?.length ?? 0,
    hasTools: !!body.tools,
    requestedModel: body.model,
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

  const decision = await route(context, config);

  const routingLatencyMs = Date.now() - startTime;

  if (decision.error) {
    log.error("Routing error", { error: decision.error });
    return {
      recommendedModel: "",
      tier: "UNKNOWN",
      taskType: decision.taskType ?? "UNKNOWN",
      complexityScore: decision.complexityScore ?? 0,
      reasoning: decision.error,
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

  const selectedProvider = decision.candidateProviders[0];

  if (!selectedProvider) {
    log.error("No provider selected");
    return {
      recommendedModel: "",
      tier: decision.tier ?? "UNKNOWN",
      taskType: decision.taskType ?? "UNKNOWN",
      complexityScore: decision.complexityScore ?? 0,
      reasoning: "No suitable provider found",
      alternatives: [],
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        contextWindow: 0,
      },
      routingLatencyMs,
      error: "No suitable provider found",
    };
  }

  const alternatives = decision.candidateProviders.slice(1, 4).map((p) => ({
    model: p.id,
    tier: p.tier,
    providerName: p.providerName,
  }));

  let reasoning = "";
  if (decision.override?.detected) {
    reasoning = `Override: using ${selectedProvider.id}`;
  } else {
    reasoning = `${decision.taskType} task, ${decision.tier} tier selected`;
    if (hasTools) reasoning += ", tool-capable model";
    if (hasImages) reasoning += ", vision-capable model";
  }

  log.info("Decision made", {
    model: selectedProvider.id,
    tier: decision.tier,
    latencyMs: routingLatencyMs,
  });

  return {
    recommendedModel: selectedProvider.id,
    tier: decision.tier ?? "UNKNOWN",
    taskType: decision.taskType ?? "UNKNOWN",
    complexityScore: decision.complexityScore ?? 0,
    reasoning,
    alternatives,
    capabilities: {
      supportsVision: selectedProvider.supportsVision,
      supportsTools: selectedProvider.supportsTools,
      supportsStreaming: selectedProvider.supportsStreaming,
      contextWindow: selectedProvider.contextWindow,
    },
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
