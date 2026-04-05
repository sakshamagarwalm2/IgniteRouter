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
  ComplexityTier.Expert,
];

function getTierDistance(requested: ComplexityTier, actual: ComplexityTier): number {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const actualIndex = TIER_ORDER.indexOf(actual);
  return Math.abs(actualIndex - requestedIndex);
}

function getBaseScore(tierDistance: number): number {
  if (tierDistance === 0) return 100;
  if (tierDistance === 1) {
    const actualIndex = 0;
    const requestedIndex = 0;
    return 100;
  }
  if (tierDistance === 1) return 60;
  if (tierDistance === 1) return 40;
  return 10;
}

function computeBaseScore(requested: ComplexityTier, actual: ComplexityTier): number {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const actualIndex = TIER_ORDER.indexOf(actual);
  const distance = Math.abs(actualIndex - requestedIndex);

  if (distance === 0) return 100;
  if (actualIndex < requestedIndex) {
    return 60;
  }
  if (distance === 1) {
    return 40;
  }
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

    const baseScore = computeBaseScore(tier, provider.tier);
    score += baseScore;
    if (baseScore === 100) scoreReasons.push("exact tier match");
    else if (baseScore === 60) scoreReasons.push("one tier above");
    else if (baseScore === 40) scoreReasons.push("one tier below");
    else scoreReasons.push("tier distance >1");

    if (priority === "cost") {
      if (provider.inputPricePerMToken === 0) {
        score += 30;
        scoreReasons.push("free/local model");
      } else if (provider.inputPricePerMToken < 0.5) {
        score += 20;
        scoreReasons.push("low cost");
      } else if (provider.inputPricePerMToken < 2.0) {
        score += 10;
        scoreReasons.push("moderate cost");
      }
      if (provider.inputPricePerMToken >= 5.0) {
        score -= 20;
        scoreReasons.push("expensive");
      }
    } else if (priority === "speed") {
      if (provider.avgLatencyMs < 400) {
        score += 30;
        scoreReasons.push("very fast");
      } else if (provider.avgLatencyMs < 800) {
        score += 15;
        scoreReasons.push("fast");
      }
      if (provider.avgLatencyMs > 1500) {
        score -= 20;
        scoreReasons.push("slow");
      }
    } else if (priority === "quality") {
      if (provider.tier === ComplexityTier.Expert) {
        score += 25;
        scoreReasons.push("expert tier for quality");
      } else if (provider.tier === ComplexityTier.Complex) {
        score += 15;
        scoreReasons.push("complex tier for quality");
      } else if (provider.tier === ComplexityTier.Medium) {
        score += 5;
        scoreReasons.push("medium tier for quality");
      }
    }

    if (provider.specialisedFor.includes(taskType)) {
      score += 25;
      scoreReasons.push(`specialised for ${taskType}`);
    }

    if (provider.avoidFor.includes(taskType)) {
      score -= 20;
      scoreReasons.push(`should avoid for ${taskType}`);
    }

    const explicitRank = provider.priorityForTasks[taskType];
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
