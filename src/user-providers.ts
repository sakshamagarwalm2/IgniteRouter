import { TaskType } from "./task-classifier.js";
import { configLog } from "./logger.js";
import { ComplexityTier } from "./complexity-scorer.js";

export interface UserProvider {
  id: string;
  apiKey?: string;
  baseUrl?: string;
  isLocal: boolean;
  tier: ComplexityTier;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  avgLatencyMs: number;
  specialisedFor: TaskType[];
  avoidFor: TaskType[];
  priorityForTasks: Partial<Record<TaskType, number>>;
}

export type ProviderPriority = "cost" | "speed" | "quality";

export interface IgniteConfig {
  defaultPriority: ProviderPriority;
  providers: UserProvider[];
}

const DEFAULT_PROVIDER: Partial<UserProvider> = {
  isLocal: false,
  tier: ComplexityTier.Medium,
  contextWindow: 128000,
  supportsVision: false,
  supportsTools: true,
  supportsStreaming: true,
  inputPricePerMToken: 1.0,
  outputPricePerMToken: 1.0,
  avgLatencyMs: 1000,
  specialisedFor: [],
  avoidFor: [],
  priorityForTasks: {},
};

const OLLAMA_DEFAULTS: Partial<UserProvider> = {
  isLocal: true,
  apiKey: undefined,
  inputPricePerMToken: 0,
  outputPricePerMToken: 0,
  avgLatencyMs: 500,
};

export const KNOWN_MODELS = new Map<string, Partial<UserProvider>>([
  [
    "openai/gpt-4o",
    {
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
      avgLatencyMs: 800,
    },
  ],
  [
    "openai/gpt-4o-mini",
    {
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 400,
    },
  ],
  [
    "openai/o3",
    {
      contextWindow: 200000,
      supportsVision: false,
      supportsTools: true,
      inputPricePerMToken: 2.0,
      outputPricePerMToken: 8.0,
      avgLatencyMs: 2000,
    },
  ],
  [
    "openai/o4-mini",
    {
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      inputPricePerMToken: 1.1,
      outputPricePerMToken: 4.4,
      avgLatencyMs: 1200,
    },
  ],
  [
    "anthropic/claude-opus-4",
    {
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 15.0,
      outputPricePerMToken: 75.0,
      avgLatencyMs: 1500,
    },
  ],
  [
    "anthropic/claude-sonnet-4",
    {
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
      avgLatencyMs: 900,
    },
  ],
  [
    "anthropic/claude-haiku-4",
    {
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 0.8,
      outputPricePerMToken: 4.0,
      avgLatencyMs: 400,
    },
  ],
  [
    "google/gemini-2.5-pro",
    {
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 1.25,
      outputPricePerMToken: 10.0,
      avgLatencyMs: 1200,
    },
  ],
  [
    "google/gemini-2.5-flash",
    {
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 400,
    },
  ],
  [
    "google/gemini-2.5-flash-lite",
    {
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 0.1,
      outputPricePerMToken: 0.4,
      avgLatencyMs: 300,
    },
  ],
  [
    "deepseek/deepseek-chat",
    {
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      inputPricePerMToken: 0.14,
      outputPricePerMToken: 0.28,
      avgLatencyMs: 600,
    },
  ],
  [
    "deepseek/deepseek-reasoner",
    {
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: false,
      inputPricePerMToken: 0.55,
      outputPricePerMToken: 2.19,
      avgLatencyMs: 2000,
    },
  ],
  [
    "openrouter/auto",
    {
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
      avgLatencyMs: 1000,
    },
  ],
]);

function mergeProvider(id: string, provided: Partial<UserProvider>): UserProvider {
  const baseDefaults: UserProvider = {
    id,
    isLocal: false,
    tier: ComplexityTier.Medium,
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 1.0,
    outputPricePerMToken: 1.0,
    avgLatencyMs: 1000,
    specialisedFor: [],
    avoidFor: [],
    priorityForTasks: {},
  };

  // Convert string tier to enum if needed
  let tierValue: ComplexityTier = ComplexityTier.Medium;
  if (typeof provided.tier === "string") {
    const tierStr = provided.tier.toUpperCase();
    if (tierStr === "SIMPLE") tierValue = ComplexityTier.Simple;
    else if (tierStr === "MEDIUM") tierValue = ComplexityTier.Medium;
    else if (tierStr === "COMPLEX") tierValue = ComplexityTier.Complex;
    else if (tierStr === "EXPERT") tierValue = ComplexityTier.Expert;
  } else if (provided.tier) {
    tierValue = provided.tier;
  }

  if (id.startsWith("ollama/")) {
    return {
      ...baseDefaults,
      isLocal: true,
      apiKey: undefined,
      inputPricePerMToken: 0,
      outputPricePerMToken: 0,
      avgLatencyMs: 500,
      ...provided,
      tier: tierValue,
    };
  }

  const knownDefaults = KNOWN_MODELS.get(id);
  if (knownDefaults) {
    configLog.debug("Provider metadata from registry", {
      id,
      contextWindow: knownDefaults.contextWindow,
      inputPrice: knownDefaults.inputPricePerMToken,
    });
  }

  return {
    ...baseDefaults,
    ...(knownDefaults ?? {}),
    ...provided,
    id,
    tier: tierValue,
    // Ensure boolean flags default to true if not explicitly false
    supportsStreaming: provided.supportsStreaming ?? (knownDefaults?.supportsStreaming ?? true),
    supportsTools: provided.supportsTools ?? (knownDefaults?.supportsTools ?? true),
    // Context window and prices also need safe fallbacks from registry
    contextWindow: provided.contextWindow ?? (knownDefaults?.contextWindow ?? baseDefaults.contextWindow),
    inputPricePerMToken: provided.inputPricePerMToken ?? (knownDefaults?.inputPricePerMToken ?? baseDefaults.inputPricePerMToken),
    outputPricePerMToken: provided.outputPricePerMToken ?? (knownDefaults?.outputPricePerMToken ?? baseDefaults.outputPricePerMToken),
  };
}

export function loadProviders(rawConfig: unknown): IgniteConfig {
  const config = rawConfig as
    | { defaultPriority?: ProviderPriority; providers?: unknown[] }
    | undefined;

  if (!config || typeof config !== "object") {
    return { defaultPriority: "cost", providers: [] };
  }

  const defaultPriority = config.defaultPriority ?? "cost";
  const providers: UserProvider[] = [];

  if (Array.isArray(config.providers)) {
    for (const entry of config.providers) {
      if (!entry || typeof entry !== "object") {
        console.warn("[IgniteRouter] Skipping invalid provider entry: not an object");
        continue;
      }

      const prov = entry as Record<string, unknown>;

      if (typeof prov.id !== "string" || !prov.id.trim()) {
        console.warn("[IgniteRouter] Skipping provider entry with missing or empty id");
        continue;
      }

      try {
        const merged = mergeProvider(prov.id, prov as Partial<UserProvider>);
        providers.push(merged);
      } catch (err) {
        configLog.warn("Skipping invalid provider", {
          id: prov.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  configLog.info("Providers loaded", { count: providers.length, priority: defaultPriority });
  return { defaultPriority, providers };
}
