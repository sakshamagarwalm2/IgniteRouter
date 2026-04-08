import { createRequire as __cjs_createRequire } from 'node:module'; const require = __cjs_createRequire(import.meta.url);

// src/logger.ts
var LEVEL_ORDER = ["trace", "debug", "info", "warn", "error"];
function shouldLog(msgLevel, minLevel) {
  return LEVEL_ORDER.indexOf(msgLevel) >= LEVEL_ORDER.indexOf(minLevel);
}
function createLogger(subsystem) {
  const minLevel = process.env.IGNITEROUTER_LOG_LEVEL ?? "info";
  function log3(level, msg, fields) {
    if (!shouldLog(level, minLevel)) return;
    const prefix = `[${subsystem}]`;
    const fieldStr = fields && Object.keys(fields).length > 0 ? " " + Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ") : "";
    switch (level) {
      case "error":
        console.error(prefix, "ERROR", msg + fieldStr);
        break;
      case "warn":
        console.warn(prefix, "WARN ", msg + fieldStr);
        break;
      case "debug":
        console.debug(prefix, "DEBUG", msg + fieldStr);
        break;
      case "trace":
        console.debug(prefix, "TRACE", msg + fieldStr);
        break;
      default:
        console.log(prefix, "INFO ", msg + fieldStr);
        break;
    }
  }
  return {
    trace: (msg, fields) => log3("trace", msg, fields),
    debug: (msg, fields) => log3("debug", msg, fields),
    info: (msg, fields) => log3("info", msg, fields),
    warn: (msg, fields) => log3("warn", msg, fields),
    error: (msg, fields) => log3("error", msg, fields),
    child: (component) => createLogger(`igniterouter/${component}`)
  };
}
var logger = createLogger("igniterouter");
var routingLog = logger.child("routing");
var proxyLog = logger.child("proxy");
var fallbackLog = logger.child("fallback");
var configLog = logger.child("config");
var overrideLog = logger.child("override");

// src/complexity-scorer.ts
function scoreToTier(score) {
  if (score < 0.2) return "SIMPLE" /* Simple */;
  if (score < 0.4) return "MEDIUM" /* Medium */;
  if (score < 0.55) return "COMPLEX" /* Complex */;
  return "REASONING" /* Reasoning */;
}
function countMatches(text, patterns, maxCount) {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text) && count < maxCount) {
      count++;
    }
  }
  return count;
}
function scoreViaKeywords(prompt) {
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
    /algorithm.*complexity/i,
    /optimize.*performance/i,
    /infinite primes/i,
    /infinite set/i,
    /postgresql/i,
    /sqlalchemy/i,
    /asyncio/i,
    /scrape.*websites/i,
    /database.*design/i,
    /compounding/i,
    /interest.*formula/i,
    /financial.*model/i,
    /monte carlo/i
  ];
  score += countMatches(lower, expertSignals, 4) * 0.35;
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
    /build.*(react|component|app|application)/i,
    /write.*(python|script|code|function|class)/i,
    /create.*(api|database|schema|server)/i,
    /design.*(database|schema|system)/i,
    /develop.*(app|application|system)/i,
    /program.*(in|to)/i,
    /coding/i,
    /code review/i,
    /architecture/i,
    /system design/i
  ];
  score += countMatches(lower, complexSignals, 4) * 0.25;
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
    /analysis/i
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
    /^thanks?$/i
  ];
  score -= countMatches(lower, simpleSignals, 2) * 0.05;
  const len = prompt.length;
  if (len > 2e3) {
    score += 0.2;
  } else if (len > 500) {
    score += 0.1;
  } else if (len > 100) {
    score += 0.05;
  }
  return Math.max(0.05, Math.min(0.95, score));
}
async function scoreComplexity(prompt, timeoutMs = 2e3) {
  const result = await (async () => {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const encodedPrompt = encodeURIComponent(prompt);
      const response = await fetch(`http://localhost:8500/score?prompt=${encodedPrompt}`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        const score = typeof data.score === "number" ? data.score : 0.5;
        const clampedScore = Math.max(0, Math.min(1, score));
        routingLog.debug("RouteLLM score", {
          score: clampedScore,
          latencyMs: Date.now() - startTime
        });
        return {
          score: clampedScore,
          tier: scoreToTier(clampedScore),
          method: "routellm",
          latencyMs: Date.now() - startTime
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
      latencyMs: Date.now() - startTime
    };
  })();
  routingLog.debug("Complexity score", {
    score: result.score,
    tier: result.tier,
    method: result.method,
    latencyMs: result.latencyMs
  });
  return result;
}

// src/openclaw-providers.ts
var DEFAULT_PROVIDER = {
  tier: "MEDIUM" /* Medium */,
  contextWindow: 128e3,
  supportsVision: false,
  supportsTools: true,
  supportsStreaming: true,
  inputPricePerMToken: 1,
  outputPricePerMToken: 1,
  avgLatencyMs: 1e3,
  specialisedFor: [],
  avoidFor: [],
  priorityForTasks: {}
};
function inferTierFromCost(cost) {
  if (!cost || cost.input === 0 && cost.output === 0) {
    return "SIMPLE" /* Simple */;
  }
  const avgPrice = (cost.input + cost.output) / 2;
  if (avgPrice < 0.5) return "SIMPLE" /* Simple */;
  if (avgPrice < 1.5) return "MEDIUM" /* Medium */;
  if (avgPrice < 3) return "COMPLEX" /* Complex */;
  return "REASONING" /* Reasoning */;
}
var EXPLICIT_TIER_MAP = {
  "deepseek/deepseek-chat": "MEDIUM" /* Medium */,
  "deepseek/deepseek-reasoner": "REASONING" /* Reasoning */,
  "xiaomi/mimo-v2-flash": "SIMPLE" /* Simple */,
  "xiaomi/mimo-v2-pro": "REASONING" /* Reasoning */,
  "xiaomi/mimo-v2-omni": "REASONING" /* Reasoning */,
  "mistral/mistral-large-latest": "COMPLEX" /* Complex */
};
function getExplicitTier(providerName, modelId) {
  const key = `${providerName}/${modelId}`;
  return EXPLICIT_TIER_MAP[key] ?? null;
}
function inferSupportsVision(model) {
  return model.input?.includes("image") ?? false;
}
function inferSupportsTools(model) {
  if (model.compat && typeof model.compat === "object") {
    const compat = model.compat;
    if ("supportsTools" in compat) {
      return compat.supportsTools === true;
    }
  }
  if (model.input?.includes("text")) return true;
  return true;
}
function loadProvidersFromOpenClaw(openclawProviders, logger2) {
  const log3 = logger2 ?? configLog;
  if (!openclawProviders || Object.keys(openclawProviders).length === 0) {
    log3.info("No OpenClaw providers found, using default fallback");
    return getDefaultProviders();
  }
  const providers = [];
  for (const [providerName, providerConfig] of Object.entries(openclawProviders)) {
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
        contextWindow: model.contextWindow ?? 128e3,
        supportsVision: inferSupportsVision(model),
        supportsTools: inferSupportsTools(model),
        supportsStreaming: true,
        inputPricePerMToken: model.cost?.input ?? 1,
        outputPricePerMToken: model.cost?.output ?? 1,
        avgLatencyMs: 1e3,
        specialisedFor: [],
        avoidFor: [],
        priorityForTasks: {}
      });
    }
  }
  log3.info("Providers loaded from OpenClaw", {
    count: providers.length,
    providers: Object.keys(openclawProviders)
  });
  return providers;
}
function getDefaultProviders() {
  const defaults = [
    {
      id: "google/gemini-2.5-flash",
      providerName: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      isLocal: false,
      tier: "SIMPLE" /* Simple */,
      contextWindow: 1e6,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 1200,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "google/gemini-2.5-pro",
      providerName: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      isLocal: false,
      tier: "COMPLEX" /* Complex */,
      contextWindow: 1e6,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 1.25,
      outputPricePerMToken: 10,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "deepseek/deepseek-chat",
      providerName: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      isLocal: false,
      tier: "MEDIUM" /* Medium */,
      contextWindow: 128e3,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.14,
      outputPricePerMToken: 0.28,
      avgLatencyMs: 1400,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "deepseek/deepseek-reasoner",
      providerName: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      isLocal: false,
      tier: "REASONING" /* Reasoning */,
      contextWindow: 128e3,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMToken: 0.55,
      outputPricePerMToken: 2.19,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "openai/gpt-4o-mini",
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      isLocal: false,
      tier: "SIMPLE" /* Simple */,
      contextWindow: 128e3,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.6,
      avgLatencyMs: 800,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "openai/gpt-4o",
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      isLocal: false,
      tier: "COMPLEX" /* Complex */,
      contextWindow: 128e3,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10,
      avgLatencyMs: 1200,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "anthropic/claude-haiku-4.5",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: "MEDIUM" /* Medium */,
      contextWindow: 2e5,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.8,
      outputPricePerMToken: 4,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: "COMPLEX" /* Complex */,
      contextWindow: 2e5,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 3,
      outputPricePerMToken: 15,
      avgLatencyMs: 2e3,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "anthropic/claude-opus-4.6",
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      tier: "REASONING" /* Reasoning */,
      contextWindow: 2e5,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 15,
      outputPricePerMToken: 75,
      avgLatencyMs: 2500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: "xai/grok-3",
      providerName: "xai",
      baseUrl: "https://api.x.ai/v1",
      isLocal: false,
      tier: "COMPLEX" /* Complex */,
      contextWindow: 131072,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 3,
      outputPricePerMToken: 15,
      avgLatencyMs: 1500,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    }
  ];
  return defaults;
}
var DEFAULT_PROVIDER_PRIORITY = "cost";
function createIgniteConfig(providers, priority = DEFAULT_PROVIDER_PRIORITY) {
  return {
    defaultPriority: priority,
    providers
  };
}

// src/task-classifier.ts
function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "object" && item !== null) {
        const obj = item;
        if (typeof obj.text === "string") return obj.text;
        if (typeof obj.content === "string") return obj.content;
      }
      if (typeof item === "string") return item;
      return "";
    }).join(" ");
  }
  return "";
}
function getLastUserMessage(messages) {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return "";
  return extractTextContent(userMessages[userMessages.length - 1].content);
}
function containsImageContent(content) {
  if (typeof content === "string") return false;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "object" && item !== null) {
        const obj = item;
        if (obj.type === "image_url" || obj.type === "image") return true;
        if (obj.type === "text" && obj.text && containsImageContent(obj.text)) return true;
      }
    }
  }
  return false;
}
function hasImageInMessages(messages) {
  for (const msg of messages) {
    if (containsImageContent(msg.content)) return true;
  }
  return false;
}
function findMatchingPattern(text, patterns) {
  const lowerText = text.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.test(lowerText)) {
      const match = lowerText.match(pattern);
      return match ? match[0] : pattern.source;
    }
  }
  return null;
}
var REASONING_PATTERNS = [
  /analyse|analyze|analysis|analyzing/,
  /compare|comparing|comparison/,
  /decide|decision|deciding/,
  /should i|which is better|what.*better/,
  /evaluate|evaluation|evaluating/,
  /pros and cons|pros\s*&\s*cons|advantages?\s*(?:and|vs)\s*disadvantages?/,
  /tradeoffs?|trade\s*offs?/,
  /step by step/,
  /explain why|reasoning|reasons?\s+(?:for|because)/,
  /think through|thinking/,
  /plan|planning|strategy|strategic/,
  /recommend|recommendation/,
  /assess|assessments?/,
  /investigate|investigation/
];
var CREATIVE_PATTERNS = [
  /write a|write an/,
  /story|stories|fiction|narrative/,
  /poem|poetry|verse/,
  /creative|creativity|creatively/,
  /brainstorm|brainstorming|ideas?/,
  /imagine|imagination/,
  /invent|invention/,
  /generate ideas|coming up with/,
  /script|dialogue|dialog|screenplay/,
  /song|lyrics|music/,
  /essay|article|blog/,
  /design\s+(?:a|this|my)/,
  /storytelling/
];
var DEEP_PATTERNS = [
  /prove|proof|theorem|lemma|corollary/,
  /formally|formal\s+(?:definition|specification|proof)/,
  /architect\s+(?:a|an|the|this)/,
  /design\s+(?:a|an|the)?\s*system/,
  /in\s+depth|comprehensive|thorough/,
  /detailed\s+analysis|analysis\s+of/,
  /research\s+(?:paper|paper|disquisition)/,
  /dissertation|thesis/,
  /whitepaper/,
  /system\s+architecture/,
  /reference\s+implementation/,
  /exhaustive|encyclopedic/
];
var AGENTIC_PATTERNS = [
  /search\s+(?:the\s+)?web|search\s+(?:and|for)/,
  /browse|look\s+up|find\s+information/,
  /execute|execution/,
  /run\s+(?:this|this\s+code|the\s+)/,
  /automate|automation/,
  /multi-?step|multi\s+step/,
  /step\s+1|first\s+step|then\s+(?:next|second)/,
  /workflow|workflows/,
  /agent/,
  /gather.*information|collect.*data/,
  /summarize.*results|summary.*of.*findings/
];
function classifyTask(messages, tools, estimatedTokens) {
  const result = (() => {
    if (hasImageInMessages(messages)) {
      return {
        taskType: "vision" /* Vision */,
        confidence: "signal",
        reason: "image detected in content"
      };
    }
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const lastUserMsg = getLastUserMessage(messages);
    if (hasTools) {
      return {
        taskType: "agentic" /* Agentic */,
        confidence: "signal",
        reason: "tools array present"
      };
    }
    const agenticMatch = findMatchingPattern(lastUserMsg, AGENTIC_PATTERNS);
    if (agenticMatch) {
      return {
        taskType: "agentic" /* Agentic */,
        confidence: "keyword",
        reason: `keyword: ${agenticMatch}`
      };
    }
    if (estimatedTokens !== void 0 && estimatedTokens > 8e3) {
      return {
        taskType: "deep" /* Deep */,
        confidence: "signal",
        reason: `token count ${estimatedTokens} > 8000`
      };
    }
    const deepMatch = findMatchingPattern(lastUserMsg, DEEP_PATTERNS);
    if (deepMatch) {
      return {
        taskType: "deep" /* Deep */,
        confidence: "keyword",
        reason: `keyword: ${deepMatch}`
      };
    }
    const reasoningMatch = findMatchingPattern(lastUserMsg, REASONING_PATTERNS);
    if (reasoningMatch) {
      return {
        taskType: "reasoning" /* Reasoning */,
        confidence: "keyword",
        reason: `keyword: ${reasoningMatch}`
      };
    }
    const creativeMatch = findMatchingPattern(lastUserMsg, CREATIVE_PATTERNS);
    if (creativeMatch) {
      return {
        taskType: "creative" /* Creative */,
        confidence: "keyword",
        reason: `keyword: ${creativeMatch}`
      };
    }
    return {
      taskType: "chat" /* Chat */,
      confidence: "default",
      reason: "default fallback"
    };
  })();
  routingLog.debug("Task classification result", {
    taskType: result.taskType,
    confidence: result.confidence,
    reason: result.reason
  });
  return result;
}

// src/override-detector.ts
var AUTO_ROUTING_VALUES = ["smartrouter/auto", "igniterouter/auto", "ignite/auto", "auto", "blockrun/auto"];
var ALIAS_MAP = {
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  o3: "openai/o3",
  "o4-mini": "openai/o4-mini",
  "claude-opus": "anthropic/claude-opus-4",
  "claude-sonnet": "anthropic/claude-sonnet-4",
  "claude-haiku": "anthropic/claude-haiku-4",
  "gemini-pro": "google/gemini-2.5-pro",
  "gemini-flash": "google/gemini-2.5-flash",
  deepseek: "deepseek/deepseek-chat"
};
function isModelIdPattern(text) {
  return text.includes("/") || Object.prototype.hasOwnProperty.call(ALIAS_MAP, text);
}
function normalizeModelId(raw) {
  const trimmed = raw.trim().toLowerCase();
  return ALIAS_MAP[trimmed] ?? trimmed;
}
function getLastUserMessage2(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content.filter((part) => typeof part === "string").join(" ");
      }
    }
  }
  return null;
}
function detectApiField(requestedModel) {
  if (!requestedModel || typeof requestedModel !== "string") {
    return null;
  }
  const normalized = requestedModel.trim().toLowerCase();
  if (AUTO_ROUTING_VALUES.includes(normalized)) {
    return null;
  }
  return {
    detected: true,
    modelId: requestedModel,
    source: "api-field",
    rawMatch: requestedModel
  };
}
function detectSlashCommand(lastMessage) {
  if (!lastMessage) {
    return null;
  }
  const slashMatch = lastMessage.match(/\/model\s+(\S+)/i);
  if (slashMatch) {
    const modelId = normalizeModelId(slashMatch[1]);
    return {
      detected: true,
      modelId,
      source: "slash-command",
      rawMatch: slashMatch[0]
    };
  }
  return null;
}
function detectPromptPatterns(lastMessage) {
  if (!lastMessage) {
    return null;
  }
  const lowerMessage = lastMessage.toLowerCase();
  const useMatch = lowerMessage.match(/use\s+(\S+)/i);
  if (useMatch && isModelIdPattern(useMatch[1])) {
    const modelId = normalizeModelId(useMatch[1]);
    return {
      detected: true,
      modelId,
      source: "prompt",
      rawMatch: useMatch[0]
    };
  }
  const atMatch = lowerMessage.match(/@(\S+)/i);
  if (atMatch && isModelIdPattern(atMatch[1])) {
    const modelId = normalizeModelId(atMatch[1]);
    return {
      detected: true,
      modelId,
      source: "prompt",
      rawMatch: `@${atMatch[1]}`
    };
  }
  const withMatch = lowerMessage.match(/with\s+(\S+)/i);
  if (withMatch && isModelIdPattern(withMatch[1])) {
    const modelId = normalizeModelId(withMatch[1]);
    return {
      detected: true,
      modelId,
      source: "prompt",
      rawMatch: `with ${withMatch[1]}`
    };
  }
  return null;
}
function isModelConfigured(modelId, providers) {
  if (!providers || providers.length === 0) {
    return true;
  }
  const normalized = modelId.toLowerCase();
  return providers.some((p) => p.id.toLowerCase() === normalized);
}
function detectOverride(messages, requestedModel, providers) {
  const apiResult = detectApiField(requestedModel);
  if (apiResult) {
    if (providers && !isModelConfigured(apiResult.modelId, providers)) {
      return { ...apiResult, notConfigured: true };
    }
    return apiResult;
  }
  const lastMessage = getLastUserMessage2(messages);
  const slashResult = detectSlashCommand(lastMessage);
  if (slashResult) {
    if (providers && !isModelConfigured(slashResult.modelId, providers)) {
      return { ...slashResult, notConfigured: true };
    }
    return slashResult;
  }
  const promptResult = detectPromptPatterns(lastMessage);
  if (promptResult) {
    if (providers && !isModelConfigured(promptResult.modelId, providers)) {
      return { ...promptResult, notConfigured: true };
    }
    return promptResult;
  }
  return { detected: false };
}

// src/priority-selector.ts
var TIER_ORDER = [
  "SIMPLE" /* Simple */,
  "MEDIUM" /* Medium */,
  "COMPLEX" /* Complex */,
  "EXPERT" /* Expert */
];
function computeBaseScore(requested, actual) {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const actualIndex = TIER_ORDER.indexOf(actual);
  const distance = Math.abs(actualIndex - requestedIndex);
  if (distance === 0) return 100;
  if (actualIndex === requestedIndex + 1) return 85;
  if (actualIndex === requestedIndex - 1) return 50;
  if (actualIndex > requestedIndex) return 30;
  return 10;
}
function selectCandidates(providers, tier, taskType, priority, requestContext) {
  const filtered = [];
  const filterReasons = /* @__PURE__ */ new Map();
  const candidates = [];
  for (const provider of providers) {
    const reasons = [];
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
        `context window too small (needs ~${requestContext.estimatedTokens}, has ${provider.contextWindow})`
      );
      filtered.push(provider);
      continue;
    }
    let score = 0;
    const scoreReasons = [];
    const baseScore = computeBaseScore(tier, provider.tier);
    score += baseScore;
    if (baseScore === 100) scoreReasons.push("exact tier match");
    else if (baseScore === 85) scoreReasons.push("one tier above");
    else if (baseScore === 50) scoreReasons.push("one tier below");
    else if (baseScore === 30) scoreReasons.push("multiple tiers above");
    else scoreReasons.push("multiple tiers below");
    if (priority === "cost") {
      if (provider.inputPricePerMToken === 0) {
        score += 10;
        scoreReasons.push("free model");
      } else if (provider.inputPricePerMToken < 0.5) {
        score += 5;
        scoreReasons.push("low cost");
      } else if (provider.inputPricePerMToken < 2) {
        score += 2;
        scoreReasons.push("moderate cost");
      }
      if (provider.inputPricePerMToken >= 5) {
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
      if (provider.tier === "EXPERT" /* Expert */) {
        score += 10;
        scoreReasons.push("expert tier for quality");
      } else if (provider.tier === "COMPLEX" /* Complex */) {
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
    const explicitRank = taskType ? (provider.priorityForTasks ?? {})[taskType] : void 0;
    if (explicitRank !== void 0) {
      score = 1e3 - explicitRank;
      scoreReasons.push(`explicit rank ${explicitRank}`);
    }
    scoreReasons.push(`base score: ${baseScore}`);
    candidates.push({
      provider,
      priorityScore: score,
      reasons: scoreReasons
    });
  }
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  return { candidates, filtered, filterReasons };
}

// src/cost-estimator.ts
var RoutingTimer = class {
  start = Date.now();
  marks = {};
  mark(phase) {
    this.marks[phase] = Date.now() - this.start;
  }
  getOverhead() {
    const end = Date.now();
    return {
      taskClassificationMs: this.marks["task"] ?? 0,
      complexityScoringMs: (this.marks["complexity"] ?? 0) - (this.marks["task"] ?? 0),
      candidateSelectionMs: (this.marks["selection"] ?? 0) - (this.marks["complexity"] ?? 0),
      totalRoutingMs: end - this.start
    };
  }
};

// src/routing-engine.ts
function detectImages(messages) {
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object" && "type" in part) {
            const partObj = part;
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
function estimateTokens(messages) {
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
async function route(context, config) {
  const timer = new RoutingTimer();
  const startTime = Date.now();
  routingLog.debug("Routing decision started", { model: context.requestedModel, tokens: context.estimatedTokens });
  const override = detectOverride(context.messages, context.requestedModel, config.providers);
  if (override.detected) {
    if (override.notConfigured) {
      return {
        override,
        candidateProviders: [],
        error: `Model '${override.modelId}' is not configured in IgniteRouter. Add it to your provider list or use igniterouter/auto for automatic routing.`,
        latencyMs: Date.now() - startTime
      };
    }
    const matchedProvider = config.providers.find(
      (p) => p.id.toLowerCase() === override.modelId.toLowerCase()
    );
    if (!matchedProvider) {
      return {
        override,
        candidateProviders: [],
        error: `Model '${override.modelId}' is not configured in IgniteRouter. Add it to your provider list or use igniterouter/auto for automatic routing.`,
        latencyMs: Date.now() - startTime
      };
    }
    routingLog.info("Override detected", { model: override.modelId, source: override.source });
    return {
      override,
      candidateProviders: [matchedProvider],
      latencyMs: Date.now() - startTime
    };
  }
  const taskResult = classifyTask(context.messages, context.tools);
  const taskType = taskResult.taskType;
  timer.mark("task");
  routingLog.debug("Task classified", { taskType, confidence: taskResult.confidence, reason: taskResult.reason });
  const complexityResult = await scoreComplexity(
    typeof context.messages[context.messages.length - 1]?.content === "string" ? context.messages[context.messages.length - 1].content : ""
  );
  timer.mark("complexity");
  routingLog.debug("Complexity scored", { score: complexityResult.score, tier: complexityResult.tier, method: complexityResult.method });
  const hasImages = detectImages(context.messages);
  const hasTools = Array.isArray(context.tools) && context.tools.length > 0;
  const needsStreaming = context.needsStreaming ?? false;
  const estimatedTokens = context.estimatedTokens ?? estimateTokens(context.messages);
  const selection = selectCandidates(
    config.providers,
    complexityResult.tier,
    taskType,
    config.defaultPriority,
    { hasImages, hasTools, needsStreaming, estimatedTokens }
  );
  timer.mark("selection");
  routingLog.info("Candidates selected", {
    count: selection.candidates.length,
    filtered: selection.filtered.length,
    top: selection.candidates[0]?.provider.id ?? "none"
  });
  if (selection.candidates.length === 0) {
    routingLog.warn("No candidates after filtering", { filtered: selection.filtered.map((p) => p.id) });
    const filteredReasons = Array.from(selection.filterReasons.entries()).map(([id, reason]) => `  ${id}: ${reason}`).join("\n");
    return {
      taskType,
      tier: complexityResult.tier,
      complexityScore: complexityResult.score,
      selection,
      candidateProviders: [],
      error: `No capable providers available:
${filteredReasons}`,
      latencyMs: Date.now() - startTime
    };
  }
  const overhead = timer.getOverhead();
  return {
    taskType,
    tier: complexityResult.tier,
    complexityScore: complexityResult.score,
    selection,
    candidateProviders: selection.candidates.map((c) => c.provider),
    latencyMs: overhead.totalRoutingMs,
    routingOverhead: overhead
  };
}

// src/decide-endpoint.ts
var log = logger.child("decide");
function estimateTokens2(messages) {
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
function detectImages2(messages) {
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object" && "type" in part) {
            const partObj = part;
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
async function handleDecideRequest(body, config) {
  const startTime = Date.now();
  log.info("Decision request received", {
    messageCount: body.messages?.length ?? 0,
    hasTools: !!body.tools,
    requestedModel: body.model
  });
  const hasImages = detectImages2(body.messages);
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const estimatedTokens = estimateTokens2(body.messages);
  const context = {
    messages: body.messages,
    tools: body.tools,
    requestedModel: body.model,
    estimatedTokens,
    needsStreaming: body.stream ?? false
  };
  const decision = await route(context, config);
  const routingLatencyMs = Date.now() - startTime;
  if (decision.error) {
    log.error("Routing error", { error: decision.error });
    return {
      recommendedModel: "",
      tier: "UNKNOWN",
      taskType: decision.taskType ?? "UNKNOWN",
      complexityScore: decision.complexityScore ?? 0,
      reasoning: decision.error,
      alternatives: [],
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        contextWindow: 0
      },
      routingLatencyMs,
      error: decision.error
    };
  }
  const selectedProvider = decision.candidateProviders[0];
  if (!selectedProvider) {
    log.error("No provider selected");
    return {
      recommendedModel: "",
      tier: decision.tier ?? "UNKNOWN",
      taskType: decision.taskType ?? "UNKNOWN",
      complexityScore: decision.complexityScore ?? 0,
      reasoning: "No suitable provider found",
      alternatives: [],
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        contextWindow: 0
      },
      routingLatencyMs,
      error: "No suitable provider found"
    };
  }
  const alternatives = decision.candidateProviders.slice(1, 4).map((p) => ({
    model: p.id,
    tier: p.tier,
    providerName: p.providerName
  }));
  let reasoning = "";
  if (decision.override?.detected) {
    reasoning = `Override: using ${selectedProvider.id}`;
  } else {
    reasoning = `${decision.taskType} task, ${decision.tier} tier selected`;
    if (hasTools) reasoning += ", tool-capable model";
    if (hasImages) reasoning += ", vision-capable model";
  }
  log.info("Decision made", {
    model: selectedProvider.id,
    tier: decision.tier,
    latencyMs: routingLatencyMs
  });
  return {
    recommendedModel: selectedProvider.id,
    tier: decision.tier ?? "UNKNOWN",
    taskType: decision.taskType ?? "UNKNOWN",
    complexityScore: decision.complexityScore ?? 0,
    reasoning,
    alternatives,
    capabilities: {
      supportsVision: selectedProvider.supportsVision,
      supportsTools: selectedProvider.supportsTools,
      supportsStreaming: selectedProvider.supportsStreaming,
      contextWindow: selectedProvider.contextWindow
    },
    routingLatencyMs
  };
}
function createDecideHandler(config) {
  return async (req) => {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST /v1/decide" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }
    try {
      const body = await req.json();
      if (!body.messages || !Array.isArray(body.messages)) {
        return new Response(JSON.stringify({ error: "Missing or invalid 'messages' array" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const decision = await handleDecideRequest(body, config);
      return new Response(JSON.stringify(decision), {
        status: decision.error ? 400 : 200,
        headers: {
          "Content-Type": "application/json",
          "X-IgniteRouter-Latency": `${decision.routingLatencyMs}ms`
        }
      });
    } catch (err) {
      log.error("Request parsing error", { error: String(err) });
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
}

// src/index.ts
import { createServer } from "http";

// src/version.ts
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var require2 = createRequire(import.meta.url);
var pkg = require2(join(__dirname, "..", "package.json"));
var VERSION = pkg.version;
var USER_AGENT = `IgniteRouter/${VERSION}`;

// src/index.ts
var log2 = logger.child("main");
var decideConfig = null;
var decideServer = null;
var decideServerPort = 8403;
function getDecidePort() {
  return decideServerPort;
}
async function startDecideServer(api, igniteConfig) {
  decideConfig = igniteConfig;
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url === "/health" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            plugin: "igniterouter",
            version: VERSION,
            mode: "decision-only",
            providers: igniteConfig.providers.length
          })
        );
        return;
      }
      if (url === "/v1/decide" && method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        try {
          const requestBody = JSON.parse(body);
          const decideHandler = createDecideHandler(igniteConfig);
          const decideReq = new Request("http://localhost/v1/decide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
          });
          const decideRes = await decideHandler(decideReq);
          const responseBody = await decideRes.text();
          res.writeHead(decideRes.status, { "Content-Type": "application/json" });
          res.end(responseBody);
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request", details: String(err) }));
        }
        return;
      }
      if (url === "/v1/models" && method === "GET") {
        const models = igniteConfig.providers.map((p) => ({
          id: p.id,
          object: "model",
          created: Date.now(),
          owned_by: p.providerName
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: models }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    server.on("error", (err) => {
      log2.error("Server error", { error: String(err) });
      reject(err);
    });
    server.listen(decideServerPort, "127.0.0.1", () => {
      const address = server.address();
      decideServerPort = address.port;
      log2.info("Decision server started", { port: decideServerPort });
      resolve();
    });
  });
}
function stopDecideServer() {
  return new Promise((resolve) => {
    if (decideServer) {
      decideServer.close(() => {
        log2.info("Decision server stopped");
        decideServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
async function createStatsCommand() {
  return {
    name: "stats",
    description: "Show IgniteRouter usage statistics",
    acceptsArgs: false,
    requireAuth: false,
    handler: async () => {
      return {
        text: "IgniteRouter stats - Decision-only mode does not track usage stats yet."
      };
    }
  };
}
async function createExcludeCommand() {
  return {
    name: "exclude",
    description: "Exclude models from routing (not applicable in decision mode)",
    acceptsArgs: true,
    requireAuth: false,
    handler: async (_ctx) => {
      return { text: "Exclusion not applicable in decision-only mode." };
    }
  };
}
function isGatewayMode() {
  return process["env"].OPENCLAW_MODE === "gateway" || process["env"].IGNITEROUTER_MODE === "gateway";
}
var igniterouter = {
  id: "igniterouter",
  name: "IgniteRouter",
  description: "Smart LLM router \u2014 Decision-only mode. Routes to cheapest capable model.",
  version: VERSION,
  register(api) {
    const directConfig = api.pluginConfig;
    const nestedConfig = api.pluginConfig?.igniterouter?.config || api.pluginConfig?.igniterouter;
    const finalConfig = nestedConfig || directConfig;
    const routingConfig = finalConfig?.routing;
    const defaultPriority = finalConfig?.defaultPriority || "cost";
    api.logger.info("IgniteRouter starting in decision-only mode");
    const openclawProviders = api.config.models?.providers;
    api.logger.info(
      `OpenClaw providers: ${openclawProviders ? Object.keys(openclawProviders).join(", ") : "none"}`
    );
    const providers = loadProvidersFromOpenClaw(openclawProviders);
    if (providers.length === 0) {
      api.logger.warn("No providers loaded from OpenClaw config");
    } else {
      api.logger.info(`Loaded ${providers.length} providers from OpenClaw config`);
      for (const p of providers) {
        api.logger.info(
          `  - ${p.id}: tier=${p.tier}, tools=${p.supportsTools}, vision=${p.supportsVision}`
        );
      }
    }
    const igniteConfig = createIgniteConfig(providers, defaultPriority);
    if (api.config.models?.providers) {
    }
    api.registerService({
      id: "igniterouter-decide",
      start: async () => {
        await startDecideServer(api, igniteConfig);
        api.logger.info(`IgniteRouter decision endpoint running on port ${getDecidePort()}`);
      },
      stop: async () => {
        await stopDecideServer();
        api.logger.info("IgniteRouter decision endpoint stopped");
      }
    });
    createStatsCommand().then((cmd) => api.registerCommand(cmd)).catch((err) => api.logger.warn(`Failed to register stats: ${err}`));
    createExcludeCommand().then((cmd) => api.registerCommand(cmd)).catch((err) => api.logger.warn(`Failed to register exclude: ${err}`));
    if (!isGatewayMode()) {
      api.logger.info("Not in gateway mode \u2014 decision server will start when gateway runs");
      return;
    }
    api.logger.info("Starting decision server in gateway mode...");
    startDecideServer(api, igniteConfig).then(() => {
      api.logger.info(`IgniteRouter ready \u2014 decision endpoint on port ${getDecidePort()}`);
      api.logger.info(`Use: POST http://localhost:${getDecidePort()}/v1/decide`);
    }).catch((err) => {
      api.logger.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
};
var index_default = igniterouter;
export {
  createIgniteConfig,
  index_default as default,
  igniterouter,
  loadProvidersFromOpenClaw,
  route
};
//# sourceMappingURL=index.js.map