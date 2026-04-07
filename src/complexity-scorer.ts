export enum ComplexityTier {
  Simple = "SIMPLE",
  Medium = "MEDIUM",
  Complex = "COMPLEX",
  Reasoning = "REASONING",
  Expert = "EXPERT",
}

export interface ComplexityResult {
  score: number;
  tier: ComplexityTier;
  method: "routellm" | "keyword-fallback";
  latencyMs: number;
}

export function scoreToTier(score: number): ComplexityTier {
  if (score < 0.3) return ComplexityTier.Simple;
  if (score < 0.5) return ComplexityTier.Medium;
  if (score < 0.7) return ComplexityTier.Complex;
  return ComplexityTier.Reasoning;
}

export async function isRouteLLMAvailable(timeoutMs = 1000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch("http://localhost:8500/health", {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function countMatches(text: string, patterns: RegExp[], maxCount: number): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text) && count < maxCount) {
      count++;
    }
  }
  return count;
}

function scoreViaKeywords(prompt: string): number {
  let score = 0.15;

  const lower = prompt.toLowerCase();

  const expertSignals = [
    /prove/i,
    /proof/i,
    /theorem/i,
    /lemma/i,
    /formally verify/i,
    /formal verification/i,
    /mathematical proof/i,
    /architect.*system/i,
    /architect.*distributed/i,
    /design.*system/i,
    /design.*scale/i,
    /dissertation/i,
    /thesis/i,
    /whitepaper/i,
    /formal specification/i,
    /np-complete/i,
    /np-hard/i,
    /big o analysis/i,
    /big-o analysis/i,
    /infinite primes/i,
    /infinite set/i,
    /postgresql/i,
    /sqlalchemy/i,
    /asyncio/i,
    /scrape.*websites/i,
    /database.*design/i,
  ];
  score += countMatches(lower, expertSignals, 3) * 0.35;

  const complexSignals = [
    /step by step/i,
    /explain in detail/i,
    /explain in depth/i,
    /compare and contrast/i,
    /comprehensive/i,
    /thorough/i,
    /in depth/i,
    /depth analysis/i,
    /analyse/i,
    /analyze/i,
    /tradeoffs?/i,
    /trade off/i,
    /implement/i,
    /implementation/i,
    /refactor/i,
    /refactoring/i,
    /debug/i,
    /why does this/i,
    /strategy/i,
    /strategic/i,
    /evaluate/i,
    /evaluation/i,
    /multiple approaches/i,
    /between .+ and .+/i,
  ];
  score += countMatches(lower, complexSignals, 3) * 0.2;

  const mediumSignals = [
    /explain/i,
    /explanation/i,
    /describe/i,
    /description/i,
    /how (does|TCP|this|it)/i,
    /what is the difference/i,
    /pros and cons/i,
    /recommend/i,
    /recommendation/i,
    /help me/i,
    /how .+ works/i,
    /compare/i,
    /analysis/i,
  ];
  score += countMatches(lower, mediumSignals, 3) * 0.1;

  const simpleSignals = [
    /^hi$/i,
    /^hello$/i,
    /^hey$/i,
    /^what is$/i,
    /^define$/i,
    /^translate$/i,
    /^yes$/i,
    /^no$/i,
    /^thanks?$/i,
  ];
  score -= countMatches(lower, simpleSignals, 2) * 0.05;

  const len = prompt.length;
  if (len > 2000) {
    score += 0.2;
  } else if (len > 500) {
    score += 0.1;
  } else if (len > 100) {
    score += 0.05;
  }

  return Math.max(0.05, Math.min(0.95, score));
}

import { routingLog } from "./logger.js";

export async function scoreComplexity(prompt: string, timeoutMs = 2000): Promise<ComplexityResult> {
  const result = await (async (): Promise<ComplexityResult> => {
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const encodedPrompt = encodeURIComponent(prompt);
      const response = await fetch(`http://localhost:8500/score?prompt=${encodedPrompt}`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as { score?: number };
        const score = typeof data.score === "number" ? data.score : 0.5;
        const clampedScore = Math.max(0, Math.min(1, score));

        routingLog.debug("RouteLLM score", {
          score: clampedScore,
          latencyMs: Date.now() - startTime,
        });

        return {
          score: clampedScore,
          tier: scoreToTier(clampedScore),
          method: "routellm",
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {
      clearTimeout(timeout);
    }

    routingLog.debug("RouteLLM unavailable, using keyword fallback");
    const keywordScore = scoreViaKeywords(prompt);

    return {
      score: keywordScore,
      tier: scoreToTier(keywordScore),
      method: "keyword-fallback",
      latencyMs: Date.now() - startTime,
    };
  })();

  routingLog.debug("Complexity score", {
    score: result.score,
    tier: result.tier,
    method: result.method,
    latencyMs: result.latencyMs,
  });

  return result;
}
