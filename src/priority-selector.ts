import { TaskType } from "./task-classifier.js";
import { ComplexityTier } from "./complexity-scorer.js";
import { UserProvider, ProviderPriority } from "./user-providers.js";

export interface RankedCandidate {
  provider: UserProvider;
  priorityScore: number;
  reasons: string[];
}

export interface SelectionResult {
  candidates: RankedCandidate[];
  filtered: UserProvider[];
  filterReasons: Map<string, string>;
}

const TIER_ORDER: ComplexityTier[] = [
  ComplexityTier.Simple,
  ComplexityTier.Medium,
  ComplexityTier.Complex,
  ComplexityTier.Reasoning,
];

function getTierDistance(requested: ComplexityTier, actual: ComplexityTier): number {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const actualIndex = TIER_ORDER.indexOf(actual);
  return Math.abs(actualIndex - requestedIndex);
}

function computeBaseScore(requested: ComplexityTier, actual: ComplexityTier): number {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const actualIndex = TIER_ORDER.indexOf(actual);
  const distance = Math.abs(actualIndex - requestedIndex);

  if (distance === 0) return 100;

  // Preferred: one tier above (quality headroom) - higher priority
  if (actualIndex === requestedIndex + 1) return 85;

  // Acceptable: one tier below (frugal)
  if (actualIndex === requestedIndex - 1) return 50;

  // Less preferred: multiple tiers above
  if (actualIndex > requestedIndex) return 30;

  // Least preferred: multiple tiers below
  return 10;
}

export function selectCandidates(
  providers: UserProvider[],
  tier: ComplexityTier,
  taskType: TaskType,
  priority: ProviderPriority,
  requestContext: {
    hasImages: boolean;
    hasTools: boolean;
    needsStreaming: boolean;
    estimatedTokens: number;
  },
): SelectionResult {
  const filtered: UserProvider[] = [];
  const filterReasons = new Map<string, string>();
  const candidates: RankedCandidate[] = [];

  for (const provider of providers) {
    const reasons: string[] = [];

    if (requestContext.hasImages && !provider.supportsVision) {
      filterReasons.set(provider.id, "no vision support");
      filtered.push(provider);
      continue;
    }

    if (requestContext.hasTools && !provider.supportsTools) {
      filterReasons.set(provider.id, "no tool calling support");
      filtered.push(provider);
      continue;
    }

    if (requestContext.needsStreaming && !provider.supportsStreaming) {
      filterReasons.set(provider.id, "no streaming support");
      filtered.push(provider);
      continue;
    }

    const maxTokens = provider.contextWindow * 0.9;
    if (requestContext.estimatedTokens > maxTokens) {
      filterReasons.set(
        provider.id,
        `context window too small (needs ~${requestContext.estimatedTokens}, has ${provider.contextWindow})`,
      );
      filtered.push(provider);
      continue;
    }

    let score = 0;
    const scoreReasons: string[] = [];

    // Base score from tier matching - most important
    const baseScore = computeBaseScore(tier, provider.tier);
    score += baseScore;
    if (baseScore === 100) scoreReasons.push("exact tier match");
    else if (baseScore === 85) scoreReasons.push("one tier above");
    else if (baseScore === 50) scoreReasons.push("one tier below");
    else if (baseScore === 30) scoreReasons.push("multiple tiers above");
    else scoreReasons.push("multiple tiers below");

    // Priority-based bonus (smaller impact than tier matching)
    if (priority === "cost") {
      if (provider.inputPricePerMToken === 0) {
        score += 10;
        scoreReasons.push("free model");
      } else if (provider.inputPricePerMToken < 0.5) {
        score += 5;
        scoreReasons.push("low cost");
      } else if (provider.inputPricePerMToken < 2.0) {
        score += 2;
        scoreReasons.push("moderate cost");
      }
      if (provider.inputPricePerMToken >= 5.0) {
        score -= 10;
        scoreReasons.push("expensive");
      }
    } else if (priority === "speed") {
      if (provider.avgLatencyMs < 400) {
        score += 10;
        scoreReasons.push("very fast");
      } else if (provider.avgLatencyMs < 800) {
        score += 5;
        scoreReasons.push("fast");
      }
      if (provider.avgLatencyMs > 1500) {
        score -= 10;
        scoreReasons.push("slow");
      }
    } else if (priority === "quality") {
      if (provider.tier === ComplexityTier.Reasoning) {
        score += 10;
        scoreReasons.push("reasoning tier for quality");
      } else if (provider.tier === ComplexityTier.Complex) {
        score += 5;
        scoreReasons.push("complex tier for quality");
      }
    }

    if ((provider.specialisedFor ?? []).includes(taskType)) {
      score += 25;
      scoreReasons.push(`specialised for ${taskType}`);
    }

    if ((provider.avoidFor ?? []).includes(taskType)) {
      score -= 20;
      scoreReasons.push(`should avoid for ${taskType}`);
    }

    const explicitRank = taskType ? (provider.priorityForTasks ?? {})[taskType] : undefined;
    if (explicitRank !== undefined) {
      score = 1000 - explicitRank;
      scoreReasons.push(`explicit rank ${explicitRank}`);
    }

    scoreReasons.push(`base score: ${baseScore}`);

    candidates.push({
      provider,
      priorityScore: score,
      reasons: scoreReasons,
    });
  }

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  return { candidates, filtered, filterReasons };
}
