/**
 * IgniteRouter Routing Configuration
 *
 * All routing parameters as a TypeScript constant.
 * This is the CLawRouter-style configuration where:
 * - Each tier has a PRIMARY model + FALLBACK chain
 * - Profiles select different tier configs (auto, eco, premium, agentic)
 * - Time-windowed promotions can override tiers
 *
 * Model details (pricing, capabilities) come from OpenClaw config.
 * This config determines which model to use for which tier.
 */

import type { Tier } from "./types.js";

export interface TierConfig {
  primary: string;
  fallback: string[];
}

export interface Promotion {
  name: string;
  startDate: string;
  endDate: string;
  tierOverrides: Partial<Record<Tier, { primary?: string; fallback?: string[] }>>;
  profiles?: ("auto" | "eco" | "premium" | "agentic")[];
}

export interface RoutingProfileConfig {
  tiers: Record<Tier, TierConfig>;
}

export interface RoutingConfig {
  version: string;
  scoring: {
    tokenCountThresholds: { simple: number; complex: number };
    tierBoundaries: { simple: number; medium: number; complex: number };
    ambiguousDefaultTier: Tier;
    maxTokensForceComplex: number;
    structuredOutputMinTier: Tier;
  };
  tiers: Record<Tier, TierConfig>;
  ecoTiers: Record<Tier, TierConfig>;
  premiumTiers: Record<Tier, TierConfig>;
  agenticTiers: Record<Tier, TierConfig>;
  promotions: Promotion[];
  overrides: {
    maxTokensForceComplex: number;
    structuredOutputMinTier: Tier;
    ambiguousDefaultTier: Tier;
    agenticMode: boolean;
  };
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  version: "2.0",

  scoring: {
    tokenCountThresholds: { simple: 50, complex: 500 },
    tierBoundaries: {
      simple: 0.2,
      medium: 0.4,
      complex: 0.55,
    },
    ambiguousDefaultTier: "MEDIUM",
    maxTokensForceComplex: 100000,
    structuredOutputMinTier: "MEDIUM",
  },

  // Auto profile - best balance of cost, speed, quality (Ollama + MiniMax)
  tiers: {
    SIMPLE: {
      primary: "ollama/llama3.2:3b",
      fallback: ["minimax/minimax-text-01", "ollama/qwen2.5:3b"],
    },
    MEDIUM: {
      primary: "ollama/llama3.1:8b",
      fallback: ["minimax/minimax-text-01", "ollama/llama3.2:3b"],
    },
    COMPLEX: {
      primary: "ollama/llama3.1:70b",
      fallback: ["minimax/minimax-text-01", "ollama/llama3.1:8b", "ollama/codellama:34b"],
    },
    REASONING: {
      primary: "minimax/minimax-reasoner",
      fallback: ["ollama/deepseek-r1:14b", "ollama/llama3.1:70b"],
    },
  },

  // Eco profile - absolute cheapest (all Ollama, free local)
  ecoTiers: {
    SIMPLE: {
      primary: "ollama/llama3.2:1b",
      fallback: ["ollama/qwen2.5:1.5b", "ollama/llama3.2:3b"],
    },
    MEDIUM: {
      primary: "ollama/llama3.2:3b",
      fallback: ["ollama/llama3.2:1b", "ollama/qwen2.5:3b"],
    },
    COMPLEX: {
      primary: "ollama/llama3.1:8b",
      fallback: ["ollama/llama3.2:3b", "ollama/codellama:7b", "minimax/minimax-text-01"],
    },
    REASONING: {
      primary: "ollama/deepseek-r1:7b",
      fallback: ["ollama/llama3.1:8b", "minimax/minimax-reasoner"],
    },
  },

  // Premium profile - best quality (MiniMax for reasoning)
  premiumTiers: {
    SIMPLE: {
      primary: "minimax/minimax-text-01",
      fallback: ["ollama/llama3.1:8b", "ollama/llama3.2:3b"],
    },
    MEDIUM: {
      primary: "minimax/minimax-text-01",
      fallback: ["ollama/llama3.1:70b", "ollama/llama3.1:8b"],
    },
    COMPLEX: {
      primary: "minimax/minimax-text-01",
      fallback: ["ollama/llama3.1:70b", "ollama/codellama:34b"],
    },
    REASONING: {
      primary: "minimax/minimax-reasoner",
      fallback: ["ollama/deepseek-r1:14b", "ollama/deepseek-r1:32b"],
    },
  },

  // Agentic profile - best for tool use / autonomous tasks
  agenticTiers: {
    SIMPLE: {
      primary: "ollama/llama3.2:3b",
      fallback: ["minimax/minimax-text-01", "ollama/llama3.2:1b"],
    },
    MEDIUM: {
      primary: "ollama/llama3.1:8b",
      fallback: ["minimax/minimax-text-01", "ollama/llama3.2:3b"],
    },
    COMPLEX: {
      primary: "ollama/llama3.1:70b",
      fallback: ["minimax/minimax-text-01", "ollama/codellama:34b"],
    },
    REASONING: {
      primary: "ollama/deepseek-r1:14b",
      fallback: ["minimax/minimax-reasoner", "ollama/deepseek-r1:32b"],
    },
  },

  // Time-windowed promotions
  promotions: [
    {
      name: "MiniMax Reasoning Promo",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      tierOverrides: {
        REASONING: { primary: "minimax/minimax-reasoner" },
      },
      profiles: ["auto", "premium"],
    },
  ],

  overrides: {
    maxTokensForceComplex: 100000,
    structuredOutputMinTier: "MEDIUM",
    ambiguousDefaultTier: "MEDIUM",
    agenticMode: false,
  },
};

export type RoutingProfile = "auto" | "eco" | "premium" | "agentic";

export function getTierConfig(
  profile: RoutingProfile,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
): Record<Tier, TierConfig> {
  switch (profile) {
    case "eco":
      return config.ecoTiers;
    case "premium":
      return config.premiumTiers;
    case "agentic":
      return config.agenticTiers;
    default:
      return config.tiers;
  }
}

export function applyPromotions(
  tierConfigs: Record<Tier, TierConfig>,
  config: RoutingConfig,
  profile: RoutingProfile,
  now: Date = new Date(),
): Record<Tier, TierConfig> {
  if (!config.promotions || config.promotions.length === 0) {
    return tierConfigs;
  }

  let result = tierConfigs;

  for (const promo of config.promotions) {
    const start = new Date(promo.startDate);
    const end = new Date(promo.endDate);

    if (now < start || now >= end) continue;
    if (promo.profiles && !promo.profiles.includes(profile)) continue;

    if (result === tierConfigs) {
      result = { ...tierConfigs };
      for (const t of Object.keys(result) as Tier[]) {
        result[t] = { ...result[t] };
      }
    }

    for (const [tier, override] of Object.entries(promo.tierOverrides) as [
      Tier,
      { primary?: string; fallback?: string[] },
    ][]) {
      if (override.primary) result[tier].primary = override.primary;
      if (override.fallback) result[tier].fallback = override.fallback;
    }
  }

  return result;
}
