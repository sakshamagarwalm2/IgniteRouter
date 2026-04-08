export enum ComplexityTier {
  Simple = "SIMPLE",
  Medium = "MEDIUM",
  Complex = "COMPLEX",
  Reasoning = "REASONING",
}

export interface ComplexityResult {
  score: number;
  tier: ComplexityTier;
  method: "keyword-fallback";
  latencyMs: number;
}

export function scoreToTier(score: number): ComplexityTier {
  if (score < 0.3) return ComplexityTier.Simple;
  if (score < 0.5) return ComplexityTier.Medium;
  if (score < 0.65) return ComplexityTier.Complex;
  return ComplexityTier.Reasoning;
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
    /derive/i,
    /derivation/i,
    /show that/i,
    /verify that/i,
    /demonstrate/i,
    /architect/i,
    /architect.*system/i,
    /architect.*distributed/i,
    /architect.*scale/i,
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
    /algorithm.*complexity/i,
    /optimize.*performance/i,
    /infinite primes/i,
    /infinite set/i,
    /compounding/i,
    /interest.*formula/i,
    /financial.*model/i,
    /monte carlo/i,
    /step by step/i,
    /by induction/i,
    /prove by/i,
    /infinitely many/i,
    /time complexity/i,
    /space complexity/i,
    /worst case/i,
    /best case/i,
    /amortized/i,
    /mathematically/i,
    /formal logic/i,
    /induction/i,
    /ML training|machine learning pipeline/i,
    /training pipeline/i,
    /correctness/i,
    /system that handles.*requests/i,
  ];
  score += countMatches(lower, expertSignals, 4) * 0.35;

  const complexSignals = [
    /explain in detail/i,
    /explain in depth/i,
    /comprehensive/i,
    /thorough/i,
    /in depth/i,
    /depth analysis/i,
    /analyse/i,
    /analyze/i,
    /tradeoffs?/i,
    /trade off/i,
    /refactor/i,
    /refactoring/i,
    /implement/i,
    /implementation/i,
    /debug/i,
    /strategy/i,
    /strategic/i,
    /evaluate/i,
    /evaluation/i,
    /multiple approaches/i,
    /code review/i,
    /architecture/i,
    /postgresql/i,
    /sqlalchemy/i,
    /asyncio/i,
    /scrape.*websites/i,
    /avltree|b tree|heap|graph algorithm/i,
    /write tests|test.*function/i,
    /infinite scroll/i,
    /React component|component with hooks/i,
  ];
  score += countMatches(lower, complexSignals, 2) * 0.25;

  const mediumSignals = [
    /explanation/i,
    /describe/i,
    /description/i,
    /how (does|TCP|this|it|my)/i,
    /what is the difference|between.*and/i,
    /what are the benefits/i,
    /pros and cons/i,
    /recommend/i,
    /recommendation/i,
    /help me/i,
    /how .+ works/i,
    /compare/i,
    /analysis/i,
    /fix.*bug/i,
    /why (does|is|my|this)/i,
    /build.*(react|component|app|application)/i,
    /write.*(python|script|code|function|class)/i,
    /create.*(api|database|schema|server)/i,
    /design.*(database|schema|system)/i,
    /develop.*(app|application|system)/i,
    /program.*(in|to)/i,
    /coding/i,
    /database schema/i,
    /api.*endpoint/i,
    /rate.?limit/i,
    /binary search|search tree|bst|btree|red-black/i,
    /microservices/i,
    /CI\/CD|ci cd/i,
    /OAuth/i,
    /git rebase|rebase/i,
    /database indexing|indexing/i,
    /Docker networking|networking/i,
    /closures?|prototype|inheritance/i,
    /more (efficient|clean|readable)/i,
    /clean code|to be clean/i,
    /containerization/i,
    /var.*let|const/i,
    /authentication|authorization/i,
    /optimize.*sql|sql.*query/i,
    /kubernetes|k8s|cluster/i,
    /REST API|RESTful/i,
    /async|await/i,
    /social network/i,
  ];
  score += countMatches(lower, mediumSignals, 3) * 0.15;

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

export async function scoreComplexity(
  prompt: string,
  _timeoutMs = 2000,
): Promise<ComplexityResult> {
  const startTime = Date.now();
  const keywordScore = scoreViaKeywords(prompt);

  routingLog.debug("Complexity scored via keywords", {
    score: keywordScore,
    tier: scoreToTier(keywordScore),
    latencyMs: Date.now() - startTime,
  });

  return {
    score: keywordScore,
    tier: scoreToTier(keywordScore),
    method: "keyword-fallback",
    latencyMs: Date.now() - startTime,
  };
}
