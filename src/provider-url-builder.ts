import { UserProvider } from "./user-providers.js";

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function stripProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) return modelId;
  return modelId.substring(slashIndex + 1);
}

export function getProviderBaseUrl(provider: UserProvider): string {
  if (provider.baseUrl) return provider.baseUrl.replace(/\/+$/, "");

  const id = provider.id.toLowerCase();
  if (id.startsWith("openai/")) return "https://api.openai.com/v1";
  if (id.startsWith("anthropic/")) return "https://api.anthropic.com/v1";
  if (id.startsWith("google/")) return "https://generativelanguage.googleapis.com/v1beta";
  if (id.startsWith("deepseek/")) return "https://api.deepseek.com/v1";
  if (id.startsWith("openrouter/")) return "https://openrouter.ai/api/v1";
  if (id.startsWith("ollama/")) return "http://localhost:11434";
  if (id.startsWith("mistral/")) return "https://api.mistral.ai/v1";
  if (id.startsWith("mistral-large-latest")) return "https://api.mistral.ai/v1";
  if (id.startsWith("mimo-") || id.startsWith("xiaomi/")) return "https://api.xiaomimimo.com/v1";

  return "";
}

export function getProviderAuthHeaders(provider: UserProvider): Record<string, string> {
  const headers: Record<string, string> = {};
  const id = provider.id.toLowerCase();

  if (provider.apiKey) {
    if (id.startsWith("anthropic/")) {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (id.startsWith("google/")) {
      // API key usually goes in query param for Google, but we can set it here if needed
      // Actually Fix 5 says key in query param
    } else {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }
  }

  return headers;
}

interface OpenAiMessage {
  role: string;
  content: string | any[];
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export function buildUpstreamRequest(
  provider: UserProvider,
  openAiBody: Record<string, any>,
): UpstreamRequest {
  const id = provider.id.toLowerCase();
  const baseUrl = getProviderBaseUrl(provider);
  const headers = getProviderAuthHeaders(provider);
  let url = `${baseUrl}/chat/completions`;
  let body: any = { ...openAiBody };

  // Strip prefix for known providers
  if (
    id.startsWith("openai/") ||
    id.startsWith("anthropic/") ||
    id.startsWith("google/") ||
    id.startsWith("deepseek/") ||
    id.startsWith("openrouter/") ||
    id.startsWith("ollama/") ||
    id.startsWith("mistral/") ||
    id.startsWith("mistral-large-latest") ||
    id.startsWith("mimo-") ||
    id.startsWith("xiaomi/")
  ) {
    body.model = stripProviderPrefix(provider.id);
  }

  if (id.startsWith("anthropic/")) {
    url = `${baseUrl}/messages`;

    // Transform OpenAI to Anthropic
    const messages: OpenAiMessage[] = openAiBody.messages || [];
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const anthropicMessages = otherMessages.map((m) => {
      let role = m.role === "assistant" ? "assistant" : "user";
      return {
        role,
        content: m.content,
      };
    });

    body = {
      model: stripProviderPrefix(provider.id),
      messages: anthropicMessages,
      system: systemMessage ? systemMessage.content : undefined,
      max_tokens: openAiBody.max_tokens || 4096,
      stream: openAiBody.stream,
      temperature: openAiBody.temperature,
      tools: openAiBody.tools,
      tool_choice: openAiBody.tool_choice,
    };
  } else if (id.startsWith("google/")) {
    const model = stripProviderPrefix(provider.id);
    url = `${baseUrl}/models/${model}:generateContent?key=${provider.apiKey}`;

    // Simplistic Google transform (can be improved)
    // For now, let's keep it basic as requested
    body = {
      contents: (openAiBody.messages || [])
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        })),
    };
    if (openAiBody.messages?.find((m: any) => m.role === "system")) {
      body.system_instruction = {
        parts: [{ text: openAiBody.messages.find((m: any) => m.role === "system").content }],
      };
    }
  } else if (id.startsWith("ollama/")) {
    // Ollama supports OpenAI-compatible /v1/chat/completions if version is recent
    url = `${baseUrl}/v1/chat/completions`;
  }

  // Final check for custom baseUrl
  if (provider.baseUrl && !id.startsWith("anthropic/") && !id.startsWith("google/")) {
    url = `${provider.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  }

  return { url, headers, body };
}
