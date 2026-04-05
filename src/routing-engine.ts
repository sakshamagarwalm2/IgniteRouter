import { classifyTask, TaskType } from "./task-classifier.js";
import { scoreComplexity, ComplexityTier } from "./complexity-scorer.js";
import { detectOverride, OverrideResult } from "./override-detector.js";
import { selectCandidates, SelectionResult } from "./priority-selector.js";
import { UserProvider, IgniteConfig } from "./user-providers.js";

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
  const startTime = Date.now();

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

    return {
      override,
      candidateProviders: [matchedProvider],
      latencyMs: Date.now() - startTime,
    };
  }

  const taskType = classifyTask(context.messages, context.tools).taskType;
  const complexityResult = await scoreComplexity(
    typeof context.messages[context.messages.length - 1]?.content === "string"
      ? (context.messages[context.messages.length - 1].content as string)
      : "",
  );

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

  if (selection.candidates.length === 0) {
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

  return {
    taskType,
    tier: complexityResult.tier,
    complexityScore: complexityResult.score,
    selection,
    candidateProviders: selection.candidates.map((c) => c.provider),
    latencyMs: Date.now() - startTime,
  };
}
