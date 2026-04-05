import { UserProvider } from "./user-providers.js";

export interface OverrideResult {
  detected: boolean;
  modelId?: string;
  source?: "prompt" | "slash-command" | "api-field";
  rawMatch?: string;
  notConfigured?: boolean;
}

const AUTO_ROUTING_VALUES = ["smartrouter/auto", "igniterouter/auto", "ignite/auto", "auto", "blockrun/auto"];

const ALIAS_MAP: Record<string, string> = {
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  o3: "openai/o3",
  "o4-mini": "openai/o4-mini",
  "claude-opus": "anthropic/claude-opus-4",
  "claude-sonnet": "anthropic/claude-sonnet-4",
  "claude-haiku": "anthropic/claude-haiku-4",
  "gemini-pro": "google/gemini-2.5-pro",
  "gemini-flash": "google/gemini-2.5-flash",
  deepseek: "deepseek/deepseek-chat",
};

function isModelIdPattern(text: string): boolean {
  return text.includes("/") || Object.prototype.hasOwnProperty.call(ALIAS_MAP, text);
}

function normalizeModelId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return ALIAS_MAP[trimmed] ?? trimmed;
}

function getLastUserMessage(messages: Array<{ role: string; content: unknown }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content.filter((part): part is string => typeof part === "string").join(" ");
      }
    }
  }
  return null;
}

function detectApiField(requestedModel?: string): OverrideResult | null {
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
    rawMatch: requestedModel,
  };
}

function detectSlashCommand(lastMessage: string | null): OverrideResult | null {
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
      rawMatch: slashMatch[0],
    };
  }

  return null;
}

function detectPromptPatterns(lastMessage: string | null): OverrideResult | null {
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
      rawMatch: useMatch[0],
    };
  }

  const atMatch = lowerMessage.match(/@(\S+)/i);
  if (atMatch && isModelIdPattern(atMatch[1])) {
    const modelId = normalizeModelId(atMatch[1]);
    return {
      detected: true,
      modelId,
      source: "prompt",
      rawMatch: `@${atMatch[1]}`,
    };
  }

  const withMatch = lowerMessage.match(/with\s+(\S+)/i);
  if (withMatch && isModelIdPattern(withMatch[1])) {
    const modelId = normalizeModelId(withMatch[1]);
    return {
      detected: true,
      modelId,
      source: "prompt",
      rawMatch: `with ${withMatch[1]}`,
    };
  }

  return null;
}

function isModelConfigured(modelId: string, providers?: UserProvider[]): boolean {
  if (!providers || providers.length === 0) {
    return true;
  }

  const normalized = modelId.toLowerCase();
  return providers.some((p) => p.id.toLowerCase() === normalized);
}

export function detectOverride(
  messages: Array<{ role: string; content: unknown }>,
  requestedModel?: string,
  providers?: UserProvider[],
): OverrideResult {
  const apiResult = detectApiField(requestedModel);
  if (apiResult) {
    if (providers && !isModelConfigured(apiResult.modelId!, providers)) {
      return { ...apiResult, notConfigured: true };
    }
    return apiResult;
  }

  const lastMessage = getLastUserMessage(messages);

  const slashResult = detectSlashCommand(lastMessage);
  if (slashResult) {
    if (providers && !isModelConfigured(slashResult.modelId!, providers)) {
      return { ...slashResult, notConfigured: true };
    }
    return slashResult;
  }

  const promptResult = detectPromptPatterns(lastMessage);
  if (promptResult) {
    if (providers && !isModelConfigured(promptResult.modelId!, providers)) {
      return { ...promptResult, notConfigured: true };
    }
    return promptResult;
  }

  return { detected: false };
}
