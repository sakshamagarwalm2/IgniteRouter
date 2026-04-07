import { ComplexityTier } from "./complexity-scorer.js";
import { TaskType } from "./task-classifier.js";
import { configLog } from "./logger.js";

export interface OpenClawModel {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  output?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
  api?: string;
}

export interface OpenClawProvider {
  baseUrl: string;
  api: string;
  apiKey?: string;
  models: OpenClawModel[];
}

export interface IgniteProvider {
  id: string;
  providerName: string;
  baseUrl: string;
  apiKey?: string;
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
  providers: IgniteProvider[];
}

const DEFAULT_PROVIDER: Partial<IgniteProvider> = {
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

function inferTierFromCost(cost: { input: number; output: number } | undefined): ComplexityTier {
  if (!cost || (cost.input === 0 && cost.output === 0)) {
    return ComplexityTier.Simple;
  }
  const avgPrice = (cost.input + cost.output) / 2;
  if (avgPrice < 0.5) return ComplexityTier.Simple;
  if (avgPrice < 1.5) return ComplexityTier.Medium;
  if (avgPrice < 3.0) return ComplexityTier.Complex;
  return ComplexityTier.Reasoning;
}

const EXPLICIT_TIER_MAP: Record<string, ComplexityTier> = {
  "deepseek/deepseek-chat": ComplexityTier.Medium,
  "deepseek/deepseek-reasoner": ComplexityTier.Reasoning,
  "xiaomi/mimo-v2-flash": ComplexityTier.Simple,
  "xiaomi/mimo-v2-pro": ComplexityTier.Reasoning,
  "xiaomi/mimo-v2-omni": ComplexityTier.Reasoning,
  "mistral/mistral-large-latest": ComplexityTier.Complex,
};

function getExplicitTier(providerName: string, modelId: string): ComplexityTier | null {
  const key = `${providerName}/${modelId}`;
  return EXPLICIT_TIER_MAP[key] ?? null;
}

function inferSupportsVision(model: OpenClawModel): boolean {
  return model.input?.includes("image") ?? false;
}

function inferSupportsTools(model: OpenClawModel): boolean {
  if (model.compat && typeof model.compat === "object") {
    const compat = model.compat as Record<string, unknown>;
    if ("supportsTools" in compat) {
      return compat.supportsTools === true;
    }
  }
  if (model.input?.includes("text")) return true;
  return true;
}

export function loadProvidersFromOpenClaw(
  openclawProviders: Record<string, OpenClawProvider> | undefined,
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  },
): IgniteProvider[] {
  const log = logger ?? configLog;

  if (!openclawProviders || Object.keys(openclawProviders).length === 0) {
    log.info("No OpenClaw providers found, using default fallback");
    return getDefaultProviders();
  }

  const providers: IgniteProvider[] = [];

  for (const [providerName, providerConfig] of Object.entries(openclawProviders)) {
    // Skip the ignite provider (our own proxy) to prevent infinite loops
    if (providerName === "ignite" || providerName === "igniterouter") {
      continue;
    }

    if (!providerConfig.models || !Array.isArray(providerConfig.models)) {
      continue;
    }

    for (const model of providerConfig.models) {
      const explicitTier = getExplicitTier(providerName, model.id);
      const tier = explicitTier ?? inferTierFromCost(model.cost);

      providers.push({
        id: `${providerName}/${model.id}`,
        providerName,
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        isLocal: false,
        tier,
        contextWindow: model.contextWindow ?? 128000,
        supportsVision: inferSupportsVision(model),
        supportsTools: inferSupportsTools(model),
        supportsStreaming: true,
        inputPricePerMToken: model.cost?.input ?? 1.0,
        outputPricePerMToken: model.cost?.output ?? 1.0,
        avgLatencyMs: 1000,
        specialisedFor: [],
        avoidFor: [],
        priorityForTasks: {},
      });
    }
  }

  log.info("Providers loaded from OpenClaw", {
    count: providers.length,
    providers: Object.keys(openclawProviders),
  });

  return providers;
}

export function getDefaultProviders(): IgniteProvider[] {
  const defaults: IgniteProvider[] = [
    {
      id: "google/gemini-2.5-flash",
      providerName: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      isLocal: false,
      tier: ComplexityTier.Simple,
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 1200,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "google/gemini-2.5-pro",
      providerName: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      isLocal: false,
      tier: ComplexityTier.Complex,
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 1.25,
      outputPricePerMToken: 10.0,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "deepseek/deepseek-chat",
      providerName: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      isLocal: false,
      tier: ComplexityTier.Medium,
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.14,
      outputPricePerMToken: 0.28,
      avgLatencyMs: 1400,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "deepseek/deepseek-reasoner",
      providerName: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      isLocal: false,
      tier: ComplexityTier.Reasoning,
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMToken: 0.55,
      outputPricePerMToken: 2.19,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "openai/gpt-4o-mini",
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      isLocal: false,
      tier: ComplexityTier.Simple,
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 800,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "openai/gpt-4o",
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      isLocal: false,
      tier: ComplexityTier.Complex,
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
      avgLatencyMs: 1200,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "anthropic/claude-haiku-4.5",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: ComplexityTier.Medium,
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.8,
      outputPricePerMToken: 4.0,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: ComplexityTier.Complex,
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
      avgLatencyMs: 2000,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "anthropic/claude-opus-4.6",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: ComplexityTier.Reasoning,
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 15.0,
      outputPricePerMToken: 75.0,
      avgLatencyMs: 2500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
    {
      id: "xai/grok-3",
      providerName: "xai",
      baseUrl: "https://api.x.ai/v1",
      isLocal: false,
      tier: ComplexityTier.Complex,
      contextWindow: 131072,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {},
    },
  ];

  return defaults;
}

export const DEFAULT_PROVIDER_PRIORITY: ProviderPriority = "cost";

export function createIgniteConfig(
  providers: IgniteProvider[],
  priority: ProviderPriority = DEFAULT_PROVIDER_PRIORITY,
): IgniteConfig {
  return {
    defaultPriority: priority,
    providers,
  };
}
