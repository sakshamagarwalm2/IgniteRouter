import * as node_http from 'node:http';

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

/**
 * Tier → Model Selection
 *
 * Maps a classification tier to the cheapest capable model.
 * Builds RoutingDecision metadata with cost estimates and savings.
 */

type ModelPricing = {
    inputPrice: number;
    outputPrice: number;
    /** Active promo flat price per request (overrides token-based pricing when set) */
    flatPrice?: number;
};
/**
 * Get the ordered fallback chain for a tier: [primary, ...fallbacks].
 */
declare function getFallbackChain(tier: Tier, tierConfigs: Record<Tier, TierConfig>): string[];
declare function calculateModelCost(model: string, modelPricing: Map<string, ModelPricing>, estimatedInputTokens: number, maxOutputTokens: number, routingProfile?: "free" | "eco" | "auto" | "premium"): {
    costEstimate: number;
    baselineCost: number;
    savings: number;
};
/**
 * Get the fallback chain filtered by context length.
 * Only returns models that can handle the estimated total context.
 *
 * @param tier - The tier to get fallback chain for
 * @param tierConfigs - Tier configurations
 * @param estimatedTotalTokens - Estimated total context (input + output)
 * @param getContextWindow - Function to get context window for a model ID
 * @returns Filtered list of models that can handle the context
 */
declare function getFallbackChainFiltered(tier: Tier, tierConfigs: Record<Tier, TierConfig>, estimatedTotalTokens: number, getContextWindow: (modelId: string) => number | undefined): string[];

/**
 * Smart Router Types
 *
 * Four classification tiers — REASONING is distinct from COMPLEX because
 * reasoning tasks need different models (o3, gemini-pro) than general
 * complex tasks (gpt-4o, sonnet-4).
 *
 * Scoring uses weighted float dimensions with sigmoid confidence calibration.
 */
type Tier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";
type RoutingDecision = {
    model: string;
    tier: Tier;
    confidence: number;
    method: "rules" | "llm";
    reasoning: string;
    costEstimate: number;
    baselineCost: number;
    savings: number;
    agenticScore?: number;
    /** Which tier configs were used (auto/eco/premium/agentic) — avoids re-derivation in proxy */
    tierConfigs?: Record<Tier, TierConfig>;
    /** Which routing profile was applied */
    profile?: "auto" | "eco" | "premium" | "agentic";
};
type RouterOptions = {
    config: RoutingConfig;
    modelPricing: Map<string, ModelPricing>;
    routingProfile?: "eco" | "auto" | "premium";
    hasTools?: boolean;
    /** Override current time for promotion window checks (for testing). Default: new Date() */
    now?: Date;
};
type TierConfig = {
    primary: string;
    fallback: string[];
};
type ScoringConfig = {
    tokenCountThresholds: {
        simple: number;
        complex: number;
    };
    codeKeywords: string[];
    reasoningKeywords: string[];
    simpleKeywords: string[];
    technicalKeywords: string[];
    creativeKeywords: string[];
    imperativeVerbs: string[];
    constraintIndicators: string[];
    outputFormatKeywords: string[];
    referenceKeywords: string[];
    negationKeywords: string[];
    domainSpecificKeywords: string[];
    agenticTaskKeywords: string[];
    dimensionWeights: Record<string, number>;
    tierBoundaries: {
        simpleMedium: number;
        mediumComplex: number;
        complexReasoning: number;
    };
    confidenceSteepness: number;
    confidenceThreshold: number;
};
type ClassifierConfig = {
    llmModel: string;
    llmMaxTokens: number;
    llmTemperature: number;
    promptTruncationChars: number;
    cacheTtlMs: number;
};
type OverridesConfig = {
    maxTokensForceComplex: number;
    structuredOutputMinTier: Tier;
    ambiguousDefaultTier: Tier;
    /**
     * When enabled, prefer models optimized for agentic workflows.
     * Agentic models continue autonomously with multi-step tasks
     * instead of stopping and waiting for user input.
     */
    agenticMode?: boolean;
};
/**
 * Time-windowed promotion that temporarily overrides tier routing.
 * Active promotions are auto-applied; expired ones are ignored at runtime.
 */
type Promotion = {
    /** Human-readable label (e.g. "GLM-5 Launch Promo") */
    name: string;
    /** ISO date string, promotion starts (inclusive). e.g. "2026-04-01" */
    startDate: string;
    /** ISO date string, promotion ends (exclusive). e.g. "2026-04-15" */
    endDate: string;
    /** Partial tier overrides — merged into the active tier configs (primary/fallback) */
    tierOverrides: Partial<Record<Tier, Partial<TierConfig>>>;
    /** Which profiles this applies to. Default: all profiles. */
    profiles?: Array<"auto" | "eco" | "premium" | "agentic">;
};
type RoutingConfig = {
    version: string;
    classifier: ClassifierConfig;
    scoring: ScoringConfig;
    tiers: Record<Tier, TierConfig>;
    /** Tier configs for agentic mode - models that excel at multi-step tasks */
    agenticTiers?: Record<Tier, TierConfig>;
    /** Tier configs for eco profile - ultra cost-optimized (blockrun/eco) */
    ecoTiers?: Record<Tier, TierConfig>;
    /** Tier configs for premium profile - best quality (blockrun/premium) */
    premiumTiers?: Record<Tier, TierConfig>;
    /** Time-windowed promotions that temporarily override tier routing */
    promotions?: Promotion[];
    overrides: OverridesConfig;
};

/**
 * Default Routing Config
 *
 * All routing parameters as a TypeScript constant.
 * Operators override via openclaw.yaml plugin config.
 *
 * Scoring uses 14 weighted dimensions with sigmoid confidence calibration.
 */

declare const DEFAULT_ROUTING_CONFIG: RoutingConfig;

/**
 * Smart Router Entry Point
 *
 * Classifies requests and routes to the cheapest capable model.
 * Delegates to pluggable RouterStrategy (default: RulesStrategy, <1ms).
 */

/**
 * Route a request to the cheapest capable model.
 * Delegates to the registered "rules" strategy by default.
 */
declare function route(prompt: string, systemPrompt: string | undefined, maxOutputTokens: number, options: RouterOptions): RoutingDecision;

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
    Expert = "EXPERT"
}

interface UserProvider {
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
type ProviderPriority = "cost" | "speed" | "quality";
interface IgniteConfig {
    defaultPriority: ProviderPriority;
    providers: UserProvider[];
}
declare function loadProviders(rawConfig: unknown): IgniteConfig;

/**
 * Response Cache for LLM Completions
 *
 * Caches LLM responses by request hash (model + messages + params).
 * Inspired by LiteLLM's caching system. Returns cached responses for
 * identical requests, saving both cost and latency.
 *
 * Features:
 * - TTL-based expiration (default 10 minutes)
 * - LRU eviction when cache is full
 * - Size limits per item (1MB max)
 * - Heap-based expiration tracking for efficient pruning
 */
type CachedLLMResponse = {
    body: Buffer;
    status: number;
    headers: Record<string, string>;
    model: string;
    cachedAt: number;
    expiresAt: number;
};
type ResponseCacheConfig = {
    /** Maximum number of cached responses. Default: 200 */
    maxSize?: number;
    /** Default TTL in seconds. Default: 600 (10 minutes) */
    defaultTTL?: number;
    /** Maximum size per cached item in bytes. Default: 1MB */
    maxItemSize?: number;
    /** Enable/disable cache. Default: true */
    enabled?: boolean;
};
declare class ResponseCache {
    private cache;
    private expirationHeap;
    private config;
    private stats;
    constructor(config?: ResponseCacheConfig);
    /**
     * Generate cache key from request body.
     * Hashes: model + messages + temperature + max_tokens + other params
     */
    static generateKey(body: Buffer | string): string;
    /**
     * Check if caching is enabled for this request.
     * Respects cache control headers and request params.
     */
    shouldCache(body: Buffer | string, headers?: Record<string, string>): boolean;
    /**
     * Get cached response if available and not expired.
     */
    get(key: string): CachedLLMResponse | undefined;
    /**
     * Cache a response with optional custom TTL.
     */
    set(key: string, response: {
        body: Buffer;
        status: number;
        headers: Record<string, string>;
        model: string;
    }, ttlSeconds?: number): void;
    /**
     * Evict expired and oldest entries to make room.
     */
    private evict;
    /**
     * Get cache statistics.
     */
    getStats(): {
        size: number;
        maxSize: number;
        hits: number;
        misses: number;
        evictions: number;
        hitRate: string;
    };
    /**
     * Clear all cached entries.
     */
    clear(): void;
    /**
     * Check if cache is enabled.
     */
    isEnabled(): boolean;
}

/**
 * Session Persistence Store
 *
 * Tracks model selections per session to prevent model switching mid-task.
 * When a session is active, the router will continue using the same model
 * instead of re-routing each request.
 */
type SessionEntry = {
    model: string;
    tier: string;
    createdAt: number;
    lastUsedAt: number;
    requestCount: number;
    recentHashes: string[];
    strikes: number;
    escalated: boolean;
    sessionCostMicros: bigint;
    priority?: "cost" | "speed" | "quality";
};
type SessionConfig = {
    /** Enable session persistence (default: false) */
    enabled: boolean;
    /** Session timeout in ms (default: 30 minutes) */
    timeoutMs: number;
    /** Header name for session ID (default: X-Session-ID) */
    headerName: string;
};
declare const DEFAULT_SESSION_CONFIG: SessionConfig;
/**
 * Session persistence store for maintaining model selections.
 */
declare class SessionStore {
    private sessions;
    private config;
    private cleanupInterval;
    constructor(config?: Partial<SessionConfig>);
    /**
     * Get the pinned model for a session, if any.
     */
    getSession(sessionId: string): SessionEntry | undefined;
    /**
     * Pin a model to a session.
     */
    setSession(sessionId: string, model: string, tier: string): void;
    /**
     * Touch a session to extend its timeout.
     */
    touchSession(sessionId: string): void;
    /**
     * Clear a specific session.
     */
    clearSession(sessionId: string): void;
    /**
     * Clear all sessions.
     */
    clearAll(): void;
    /**
     * Get session stats for debugging.
     */
    getStats(): {
        count: number;
        sessions: Array<{
            id: string;
            model: string;
            age: number;
        }>;
    };
    /**
     * Clean up expired sessions.
     */
    private cleanup;
    /**
     * Record a request content hash and detect repetitive patterns.
     * Returns true if escalation should be triggered (3+ consecutive similar requests).
     */
    recordRequestHash(sessionId: string, hash: string): boolean;
    /**
     * Escalate session to next tier. Returns the new model/tier or null if already at max.
     */
    escalateSession(sessionId: string, tierConfigs: Record<string, {
        primary: string;
        fallback: string[];
    }>): {
        model: string;
        tier: string;
    } | null;
    /**
     * Add cost to a session's running total for maxCostPerRun tracking.
     * Cost is in USDC 6-decimal units (micros).
     * Creates a cost-tracking-only entry if none exists (e.g., explicit model requests
     * that never go through the routing path).
     */
    addSessionCost(sessionId: string, additionalMicros: bigint): void;
    /**
     * Get the total accumulated cost for a session in USD.
     */
    getSessionCostUsd(sessionId: string): number;
    /**
     * Set the routing priority for a session.
     */
    setSessionPriority(sessionId: string, priority: "cost" | "speed" | "quality"): void;
    /**
     * Stop the cleanup interval.
     */
    close(): void;
}
/**
 * Generate a session ID from request headers or create a default.
 */
declare function getSessionId(headers: Record<string, string | string[] | undefined>, headerName?: string): string | undefined;
/**
 * Generate a short hash fingerprint from request content.
 * Captures: last user message text + tool call names (if any).
 * Normalizes whitespace to avoid false negatives from minor formatting diffs.
 */
declare function hashRequestContent(lastUserContent: string, toolCallNames?: string[]): string;

/**
 * Get the proxy port from pre-loaded configuration.
 * Port is validated at module load time, this just returns the cached value.
 */
declare function getProxyPort(): number;
type ProxyOptions = {
    apiBase?: string;
    port?: number;
    routingConfig?: Partial<RoutingConfig>;
    requestTimeoutMs?: number;
    sessionConfig?: Partial<SessionConfig>;
    autoCompressRequests?: boolean;
    compressionThresholdKB?: number;
    cacheConfig?: ResponseCacheConfig;
    maxCostPerRunUsd?: number;
    maxCostPerRunMode?: "graceful" | "strict";
    excludeModels?: Set<string>;
    onReady?: (port: number) => void;
    onError?: (error: Error) => void;
    onRouted?: (decision: RoutingDecision) => void;
    upstreamProxy?: string;
    igniteConfig?: IgniteConfig;
};
type ProxyHandle = {
    port: number;
    baseUrl: string;
    server?: node_http.Server;
    close: () => Promise<void>;
};
/**
 * Start the local proxy server.
 *
 * If a proxy is already running on the target port, reuses it instead of failing.
 * Port can be configured via IGNITEROUTER_PROXY_PORT environment variable.
 *
 * Returns a handle with the assigned port, base URL, and a close function.
 */
declare function startProxy(options: ProxyOptions): Promise<ProxyHandle>;

/**
 * IgniteRouter ProviderPlugin for OpenClaw
 *
 * Registers IgniteRouter as an LLM provider in OpenClaw.
 * Uses a local proxy to handle requests transparently —
 * pi-ai sees a standard OpenAI-compatible API at localhost.
 */

declare const igniteProvider: ProviderPlugin;

/**
 * BlockRun Model Definitions for OpenClaw
 *
 * Maps BlockRun's 55+ AI models to OpenClaw's ModelDefinitionConfig format.
 * All models use the "openai-completions" API since BlockRun is OpenAI-compatible.
 *
 * Pricing is in USD per 1M tokens. Operators pay these rates via x402;
 * they set their own markup when reselling to end users (Phase 2).
 */

/**
 * Model aliases for convenient shorthand access.
 * Users can type `/model claude` instead of `/model blockrun/anthropic/claude-sonnet-4-6`.
 */
declare const MODEL_ALIASES: Record<string, string>;
/**
 * Resolve a model alias to its full model ID.
 * Also strips "blockrun/" prefix for direct model paths.
 * Examples:
 *   - "claude" -> "anthropic/claude-sonnet-4-6" (alias)
 *   - "blockrun/claude" -> "anthropic/claude-sonnet-4-6" (alias with prefix)
 *   - "blockrun/anthropic/claude-sonnet-4-6" -> "anthropic/claude-sonnet-4-6" (prefix stripped)
 *   - "openai/gpt-4o" -> "openai/gpt-4o" (unchanged)
 */
declare function resolveModelAlias(model: string): string;
type BlockRunModel = {
    id: string;
    name: string;
    /** Model version (e.g., "4.6", "3.1", "5.2") for tracking updates */
    version?: string;
    inputPrice: number;
    outputPrice: number;
    contextWindow: number;
    maxOutput: number;
    reasoning?: boolean;
    vision?: boolean;
    /** Models optimized for agentic workflows (multi-step autonomous tasks) */
    agentic?: boolean;
    /**
     * Model supports OpenAI-compatible structured function/tool calling.
     * Models without this flag output tool invocations as plain text JSON,
     * which leaks raw {"command":"..."} into visible chat messages.
     * Default: false (must opt-in to prevent silent regressions on new models).
     */
    toolCalling?: boolean;
    /** Model is deprecated — will be routed to fallbackModel if set */
    deprecated?: boolean;
    /** Model ID to route to when this model is deprecated */
    fallbackModel?: string;
    /** Time-limited promotional pricing — auto-expires after endDate */
    promo?: {
        /** Flat price per request in USD (replaces token-based pricing) */
        flatPrice: number;
        /** ISO date, promo starts (inclusive). e.g. "2026-04-01" */
        startDate: string;
        /** ISO date, promo ends (exclusive). e.g. "2026-04-15" */
        endDate: string;
    };
};
declare const BLOCKRUN_MODELS: BlockRunModel[];
/**
 * All BlockRun models in OpenClaw format (including aliases).
 */
declare const OPENCLAW_MODELS: ModelDefinitionConfig[];
/**
 * Build a ModelProviderConfig for BlockRun.
 *
 * @param baseUrl - The proxy's local base URL (e.g., "http://127.0.0.1:12345")
 */
declare function buildProviderModels(baseUrl: string): ModelProviderConfig;
/**
 * Check if a model is optimized for agentic workflows.
 * Agentic models continue autonomously with multi-step tasks
 * instead of stopping and waiting for user input.
 */
declare function isAgenticModel(modelId: string): boolean;
/**
 * Get all agentic-capable models.
 */
declare function getAgenticModels(): string[];
/**
 * Get context window size for a model.
 * Returns undefined if model not found.
 */
declare function getModelContextWindow(modelId: string): number | undefined;

/**
 * Usage Logger
 *
 * Logs every LLM request as a JSON line to a daily log file.
 * Files: ~/.openclaw/blockrun/logs/usage-YYYY-MM-DD.jsonl
 *
 * MVP: append-only JSON lines. No rotation, no cleanup.
 * Logging never breaks the request flow — all errors are swallowed.
 */
type UsageEntry = {
    timestamp: string;
    model: string;
    tier: string;
    cost: number;
    baselineCost: number;
    savings: number;
    latencyMs: number;
    /** Whether the request completed successfully or ended in an error */
    status?: "success" | "error";
    /** Input (prompt) tokens reported by the provider */
    inputTokens?: number;
    /** Output (completion) tokens reported by the provider */
    outputTokens?: number;
    /** Partner service ID (e.g., "x_users_lookup") — only set for partner API calls */
    partnerId?: string;
    /** Partner service name (e.g., "AttentionVC") — only set for partner API calls */
    service?: string;
};
/**
 * Log a usage entry as a JSON line.
 */
declare function logUsage(entry: UsageEntry): Promise<void>;

/**
 * Request Deduplication
 *
 * Prevents double-charging when OpenClaw retries a request after timeout.
 * Tracks in-flight requests and caches completed responses for a short TTL.
 */
type CachedResponse = {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
    completedAt: number;
};
declare class RequestDeduplicator {
    private inflight;
    private completed;
    private ttlMs;
    constructor(ttlMs?: number);
    /** Hash request body to create a dedup key. */
    static hash(body: Buffer): string;
    /** Check if a response is cached for this key. */
    getCached(key: string): CachedResponse | undefined;
    /** Check if a request with this key is currently in-flight. Returns a promise to wait on. */
    getInflight(key: string): Promise<CachedResponse> | undefined;
    /** Mark a request as in-flight. */
    markInflight(key: string): void;
    /** Complete an in-flight request — cache result and notify waiters. */
    complete(key: string, result: CachedResponse): void;
    /** Remove an in-flight entry on error (don't cache failures).
     *  Also rejects any waiters so they can retry independently. */
    removeInflight(key: string): void;
    /** Prune expired completed entries. */
    private prune;
}

/**
 * Retry Logic for ClawRouter
 *
 * Provides fetch wrapper with exponential backoff for transient errors.
 * Retries on 429 (rate limit), 502, 503, 504 (server errors).
 */
/** Configuration for retry behavior */
type RetryConfig = {
    /** Maximum number of retries (default: 2) */
    maxRetries: number;
    /** Base delay in ms for exponential backoff (default: 500) */
    baseDelayMs: number;
    /** HTTP status codes that trigger a retry (default: [429, 502, 503, 504]) */
    retryableCodes: number[];
};
/** Default retry configuration */
declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Wrap a fetch-like function with retry logic and exponential backoff.
 *
 * @param fetchFn - The fetch function to wrap (can be standard fetch or x402 payFetch)
 * @param url - URL to fetch
 * @param init - Fetch init options
 * @param config - Retry configuration (optional, uses defaults)
 * @returns Response from successful fetch or last failed attempt
 *
 * @example
 * ```typescript
 * const response = await fetchWithRetry(
 *   fetch,
 *   "https://api.example.com/endpoint",
 *   { method: "POST", body: JSON.stringify(data) },
 *   { maxRetries: 3 }
 * );
 * ```
 */
declare function fetchWithRetry(fetchFn: (url: string, init?: RequestInit) => Promise<Response>, url: string, init?: RequestInit, config?: Partial<RetryConfig>): Promise<Response>;
/**
 * Check if an error or response indicates a retryable condition.
 */
declare function isRetryable(errorOrResponse: Error | Response, config?: Partial<RetryConfig>): boolean;

/**
 * Usage Statistics Aggregator
 *
 * Reads usage log files and aggregates statistics for terminal display.
 * Supports filtering by date range and provides multiple aggregation views.
 */
type DailyStats = {
    date: string;
    totalRequests: number;
    avgLatencyMs: number;
    byTier: Record<string, {
        count: number;
    }>;
    byModel: Record<string, {
        count: number;
    }>;
};
type AggregatedStats = {
    period: string;
    totalRequests: number;
    avgLatencyMs: number;
    avgLatencyPerRequest: number;
    byTier: Record<string, {
        count: number;
        percentage: number;
    }>;
    byModel: Record<string, {
        count: number;
        percentage: number;
    }>;
    dailyBreakdown: DailyStats[];
};
declare function getStats(days?: number): Promise<AggregatedStats>;
declare function formatStatsAscii(stats: AggregatedStats): string;
declare function clearStats(): Promise<{
    deletedFiles: number;
}>;

/**
 * Partner Service Registry
 *
 * Defines available partner APIs that can be called through ClawRouter's proxy.
 * Partners provide specialized data (Twitter/X, etc.) via x402 micropayments.
 * The same wallet used for LLM calls pays for partner API calls — zero extra setup.
 */
type PartnerServiceParam = {
    name: string;
    type: "string" | "string[]" | "number";
    description: string;
    required: boolean;
};
type PartnerServiceDefinition = {
    /** Unique service ID used in tool names: blockrun_{id} */
    id: string;
    /** Human-readable name */
    name: string;
    /** Partner providing this service */
    partner: string;
    /** Short description for tool listing */
    description: string;
    /** Proxy path (relative to /v1) */
    proxyPath: string;
    /** HTTP method */
    method: "GET" | "POST";
    /** Parameters for the tool's JSON Schema */
    params: PartnerServiceParam[];
    /** Pricing info for display */
    pricing: {
        perUnit: string;
        unit: string;
        minimum: string;
        maximum: string;
    };
    /** Example usage for help text */
    example: {
        input: Record<string, unknown>;
        description: string;
    };
};
/**
 * All registered partner services.
 * New partners are added here — the rest of the system picks them up automatically.
 */
declare const PARTNER_SERVICES: PartnerServiceDefinition[];
/**
 * Get a partner service by ID.
 */
declare function getPartnerService(id: string): PartnerServiceDefinition | undefined;

/**
 * Partner Tool Builder
 *
 * Converts partner service definitions into OpenClaw tool definitions.
 * Each tool's execute() calls through the local proxy which handles
 * x402 payment transparently using the same wallet.
 */
/** OpenClaw tool definition shape (duck-typed) */
type PartnerToolDefinition = {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
/**
 * Build OpenClaw tool definitions for all registered partner services.
 * @param proxyBaseUrl - Local proxy base URL (e.g., "http://127.0.0.1:8402")
 */
declare function buildPartnerTools(proxyBaseUrl: string): PartnerToolDefinition[];

/**
 * @igniterouter/igniterouter
 *
 * Smart LLM router for OpenClaw — 55+ models, intelligent routing, 78% cost savings.
 * Routes each request to the cheapest model that can handle it.
 *
 * Usage:
 *   # Install the plugin
 *   openclaw plugins install @igniterouter/igniterouter
 *
 *   # Use smart routing (auto-picks cheapest model)
 *   openclaw models set ignite/auto
 *
 *   # Or use any specific model
 *   openclaw models set openai/gpt-5.3
 */

declare const plugin: OpenClawPluginDefinition;

export { type AggregatedStats, BLOCKRUN_MODELS, type CachedLLMResponse, type CachedResponse, DEFAULT_RETRY_CONFIG, DEFAULT_ROUTING_CONFIG, DEFAULT_SESSION_CONFIG, type DailyStats, MODEL_ALIASES, OPENCLAW_MODELS, PARTNER_SERVICES, type PartnerServiceDefinition, type PartnerToolDefinition, type ProxyHandle, type ProxyOptions, RequestDeduplicator, ResponseCache, type ResponseCacheConfig, type RetryConfig, type RoutingConfig, type RoutingDecision, type SessionConfig, type SessionEntry, SessionStore, type Tier, type UsageEntry, buildPartnerTools, buildProviderModels, calculateModelCost, clearStats, plugin as default, fetchWithRetry, formatStatsAscii, getAgenticModels, getFallbackChain, getFallbackChainFiltered, getModelContextWindow, getPartnerService, getProxyPort, getSessionId, getStats, hashRequestContent, igniteProvider, isAgenticModel, isRetryable, loadProviders, logUsage, resolveModelAlias, route, startProxy };
