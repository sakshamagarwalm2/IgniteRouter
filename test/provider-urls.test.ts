import { describe, it, expect } from "vitest";
import { buildUpstreamRequest, stripProviderPrefix, getProviderBaseUrl, getProviderAuthHeaders } from "../src/provider-url-builder.js";
import { ComplexityTier } from "../src/complexity-scorer.js";

describe("Provider URL Builder", () => {
  const mockProvider = (id: string, extra = {}) => ({
    id,
    apiKey: "test-key",
    isLocal: false,
    tier: ComplexityTier.Medium,
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 1.0,
    outputPricePerMToken: 1.0,
    avgLatencyMs: 1000,
    specialisedFor: [],
    avoidFor: [],
    priorityForTasks: {},
    ...extra
  });

  it("PU01: openai/gpt-4o -> correct URL, header, and model", () => {
    const p = mockProvider("openai/gpt-4o");
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers["Authorization"]).toBe("Bearer test-key");
    expect((req.body as any).model).toBe("gpt-4o");
  });

  it("PU02: anthropic/claude-sonnet-4 -> correct URL and headers", () => {
    const p = mockProvider("anthropic/claude-sonnet-4");
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("test-key");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("PU03: google/gemini-2.5-flash -> URL contains key", () => {
    const p = mockProvider("google/gemini-2.5-flash");
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toContain("generativelanguage.googleapis.com");
    expect(req.url).toContain("key=test-key");
  });

  it("PU04: deepseek/deepseek-chat -> correct URL", () => {
    const p = mockProvider("deepseek/deepseek-chat");
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("PU05: openrouter/auto -> correct URL", () => {
    const p = mockProvider("openrouter/auto");
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((req.body as any).model).toBe("auto");
  });

  it("PU06: ollama/llama3:8b -> correct URL", () => {
    const p = mockProvider("ollama/llama3:8b", { baseUrl: "http://localhost:11434" });
    const req = buildUpstreamRequest(p, { model: "igniterouter/auto", messages: [] });
    expect(req.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("PU08: stripProviderPrefix works", () => {
    expect(stripProviderPrefix("openai/gpt-4o")).toBe("gpt-4o");
    expect(stripProviderPrefix("ollama/llama3:8b")).toBe("llama3:8b");
    expect(stripProviderPrefix("custom-model")).toBe("custom-model");
  });

  it("PU10: Anthropic format transform: OpenAI system message pulled out", () => {
    const p = mockProvider("anthropic/claude-sonnet-4");
    const openAiBody = {
      model: "igniterouter/auto",
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" }
      ]
    };
    const req = buildUpstreamRequest(p, openAiBody);
    const body = req.body as any;
    expect(body.system).toBe("You are a helpful assistant");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("Hello");
  });
});
