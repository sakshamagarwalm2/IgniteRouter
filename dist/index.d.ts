/**
 * OpenClaw Plugin Types (locally defined)
 *
 * OpenClaw's plugin SDK uses duck typing — these match the shapes
 * expected by registerProvider() and the plugin system.
 * Defined locally to avoid depending on internal OpenClaw paths.
 */
type ModelApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai" | "github-copilot" | "bedrock-converse-stream";
type ModelDefinitionConfig = {
    id: string;
    name: string;
    api?: ModelApi;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
};
type ModelProviderConfig = {
    baseUrl: string;
    apiKey?: string;
    api?: ModelApi;
    headers?: Record<string, string>;
    authHeader?: boolean;
    models: ModelDefinitionConfig[];
};
type AuthProfileCredential = {
    apiKey?: string;
    type?: string;
    [key: string]: unknown;
};
type ProviderAuthResult = {
    profiles: Array<{
        profileId: string;
        credential: AuthProfileCredential;
    }>;
    configPatch?: Record<string, unknown>;
    defaultModel?: string;
    notes?: string[];
};
type WizardPrompter = {
    text: (opts: {
        message: string;
        validate?: (value: string) => string | undefined;
    }) => Promise<string | symbol>;
    note: (message: string) => void;
    progress: (message: string) => {
        stop: (message?: string) => void;
    };
};
type ProviderAuthContext = {
    config: Record<string, unknown>;
    agentDir?: string;
    workspaceDir?: string;
    prompter: WizardPrompter;
    runtime: {
        log: (message: string) => void;
    };
    isRemote: boolean;
    openUrl: (url: string) => Promise<void>;
};
type ProviderAuthMethod = {
    id: string;
    label: string;
    hint?: string;
    kind: "oauth" | "api_key" | "token" | "device_code" | "custom";
    run: (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;
};
type ProviderPlugin = {
    id: string;
    label: string;
    docsPath?: string;
    aliases?: string[];
    envVars?: string[];
    models?: ModelProviderConfig;
    auth: ProviderAuthMethod[];
    formatApiKey?: (cred: AuthProfileCredential) => string;
};
type PluginLogger = {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
};
type OpenClawPluginService = {
    id: string;
    start: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
};
type OpenClawPluginApi = {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    config: Record<string, unknown> & {
        models?: {
            providers?: Record<string, ModelProviderConfig>;
        };
        agents?: Record<string, unknown>;
    };
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    registerProvider: (provider: ProviderPlugin) => void;
    registerTool: (tool: unknown, opts?: unknown) => void;
    registerHook: (events: string | string[], handler: unknown, opts?: unknown) => void;
    registerHttpRoute: (params: {
        path: string;
        handler: unknown;
    }) => void;
    registerService: (service: OpenClawPluginService) => void;
    registerCommand: (command: unknown) => void;
    resolvePath: (input: string) => string;
    on: (hookName: string, handler: unknown, opts?: unknown) => void;
};
type OpenClawPluginDefinition = {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    register?: (api: OpenClawPluginApi) => void | Promise<void>;
    activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};

declare enum TaskType {
    Chat = "chat",
    Creative = "creative",
    Reasoning = "reasoning",
    Agentic = "agentic",
    Vision = "vision",
    Deep = "deep"
}

declare enum ComplexityTier {
    Simple = "SIMPLE",
    Medium = "MEDIUM",
    Complex = "COMPLEX",
    Reasoning = "REASONING",
    Expert = "EXPERT"
}

interface OpenClawModel {
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
interface OpenClawProvider {
    baseUrl: string;
    api: string;
    apiKey?: string;
    models: OpenClawModel[];
}
interface IgniteProvider {
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
type ProviderPriority = "cost" | "speed" | "quality";
interface IgniteConfig {
    defaultPriority: ProviderPriority;
    providers: IgniteProvider[];
}
declare function loadProvidersFromOpenClaw(openclawProviders: Record<string, OpenClawProvider> | undefined, logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
}): IgniteProvider[];
declare function createIgniteConfig(providers: IgniteProvider[], priority?: ProviderPriority): IgniteConfig;

interface OverrideResult {
    detected: boolean;
    modelId?: string;
    source?: "prompt" | "slash-command" | "api-field";
    rawMatch?: string;
    notConfigured?: boolean;
}

interface RankedCandidate {
    provider: IgniteProvider;
    priorityScore: number;
    reasons: string[];
}
interface SelectionResult {
    candidates: RankedCandidate[];
    filtered: IgniteProvider[];
    filterReasons: Map<string, string>;
}

interface RoutingOverhead {
    taskClassificationMs: number;
    complexityScoringMs: number;
    candidateSelectionMs: number;
    totalRoutingMs: number;
}

interface RoutingContext {
    messages: Array<{
        role: string;
        content: unknown;
    }>;
    tools?: unknown[];
    requestedModel?: string;
    estimatedTokens?: number;
    needsStreaming?: boolean;
}
interface RoutingDecision {
    override?: OverrideResult;
    taskType?: TaskType;
    tier?: ComplexityTier;
    complexityScore?: number;
    selection?: SelectionResult;
    candidateProviders: IgniteProvider[];
    error?: string;
    latencyMs: number;
    routingOverhead?: RoutingOverhead;
    tierConfigs?: Record<string, any>;
}
declare function route(context: RoutingContext, config: IgniteConfig): Promise<RoutingDecision>;

/**
 * @igniterouter/igniterouter
 *
 * Smart LLM Router for OpenClaw — Decision-Only Mode
 *
 * This module provides intelligent routing decisions WITHOUT calling LLM.
 * OpenClaw calls the /v1/decide endpoint to get model recommendations,
 * then calls the LLM directly.
 *
 * Usage:
 *   # Install the plugin
 *   openclaw plugins install @igniterouter/igniterouter
 *
 *   # Use smart routing - OpenClaw will call /v1/decide before each request
 *   openclaw models set ignite/auto
 */

declare const igniterouter: OpenClawPluginDefinition;

export { type IgniteConfig, type IgniteProvider, type RoutingContext, type RoutingDecision, createIgniteConfig, igniterouter as default, igniterouter, loadProvidersFromOpenClaw, route };
