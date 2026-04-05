import { describe, expect, it } from "vitest";
import { loadProviders, KNOWN_MODELS, IgniteConfig, UserProvider } from "./user-providers.js";
import { detectOverride } from "./override-detector.js";
import { ComplexityTier } from "./complexity-scorer.js";

describe("loadProviders", () => {
  it("loadProviders(undefined) → valid config with empty providers, defaultPriority=cost", () => {
    const config = loadProviders(undefined);
    expect(config.defaultPriority).toBe("cost");
    expect(config.providers).toEqual([]);
  });

  it("loadProviders({}) → valid config with empty providers", () => {
    const config = loadProviders({});
    expect(config.defaultPriority).toBe("cost");
    expect(config.providers).toEqual([]);
  });

  it("loadProviders with known model id → fills in contextWindow, vision, prices from registry", () => {
    const config = loadProviders({
      providers: [{ id: "openai/gpt-4o", tier: ComplexityTier.Complex }],
    });

    expect(config.providers).toHaveLength(1);
    const provider = config.providers[0];
    expect(provider.id).toBe("openai/gpt-4o");
    expect(provider.contextWindow).toBe(128000);
    expect(provider.supportsVision).toBe(true);
    expect(provider.inputPricePerMToken).toBe(2.5);
    expect(provider.outputPricePerMToken).toBe(10.0);
    expect(provider.tier).toBe(ComplexityTier.Complex);
  });

  it("loadProviders with ollama model → isLocal=true, prices=0", () => {
    const config = loadProviders({
      providers: [{ id: "ollama/llama3", tier: ComplexityTier.Medium }],
    });

    expect(config.providers).toHaveLength(1);
    const provider = config.providers[0];
    expect(provider.id).toBe("ollama/llama3");
    expect(provider.isLocal).toBe(true);
    expect(provider.inputPricePerMToken).toBe(0);
    expect(provider.outputPricePerMToken).toBe(0);
    expect(provider.avgLatencyMs).toBe(500);
  });

  it("loadProviders with unknown model id → gets sensible defaults, does not throw", () => {
    const config = loadProviders({
      providers: [{ id: "unknown/model-xyz", tier: ComplexityTier.Simple }],
    });

    expect(config.providers).toHaveLength(1);
    const provider = config.providers[0];
    expect(provider.id).toBe("unknown/model-xyz");
    expect(provider.contextWindow).toBe(128000);
    expect(provider.supportsVision).toBe(false);
    expect(provider.supportsTools).toBe(true);
    expect(provider.inputPricePerMToken).toBe(1.0);
    expect(provider.outputPricePerMToken).toBe(1.0);
  });

  it("loadProviders with malformed provider entry → skips it, does not throw", () => {
    const config = loadProviders({
      providers: [
        { id: "valid/model", tier: ComplexityTier.Medium },
        null,
        undefined,
        { notId: "test" },
        { id: "" },
        { id: "   " },
      ],
    });

    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe("valid/model");
  });

  it("loadProviders with custom defaultPriority", () => {
    const config = loadProviders({
      defaultPriority: "quality",
      providers: [],
    });

    expect(config.defaultPriority).toBe("quality");
  });
});

describe("detectOverride", () => {
  it('requestedModel="openai/gpt-4o" → detected:true, source:api-field, modelId:openai/gpt-4o', () => {
    const result = detectOverride([], "openai/gpt-4o");
    expect(result.detected).toBe(true);
    expect(result.source).toBe("api-field");
    expect(result.modelId).toBe("openai/gpt-4o");
  });

  it('requestedModel="smartrouter/auto" → detected:false', () => {
    const result = detectOverride([], "smartrouter/auto");
    expect(result.detected).toBe(false);
  });

  it('requestedModel="auto" → detected:false', () => {
    const result = detectOverride([], "auto");
    expect(result.detected).toBe(false);
  });

  it('message="/model claude-sonnet" → detected:true, source:slash-command, modelId:anthropic/claude-sonnet-4', () => {
    const messages = [{ role: "user", content: "/model claude-sonnet" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.source).toBe("slash-command");
    expect(result.modelId).toBe("anthropic/claude-sonnet-4");
  });

  it('message="use gpt-4o for this" → detected:true, source:prompt', () => {
    const messages = [{ role: "user", content: "use gpt-4o for this" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.source).toBe("prompt");
    expect(result.modelId).toBe("openai/gpt-4o");
  });

  it('message="@openai/gpt-4o help me" → detected:true, source:prompt', () => {
    const messages = [{ role: "user", content: "@openai/gpt-4o help me" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.source).toBe("prompt");
    expect(result.modelId).toBe("openai/gpt-4o");
  });

  it('message="hello how are you" → detected:false', () => {
    const messages = [{ role: "user", content: "hello how are you" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(false);
  });

  it('message="use the best model" → detected:false (no valid model ID)', () => {
    const messages = [{ role: "user", content: "use the best model" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(false);
  });

  it("api-field takes priority over slash-command", () => {
    const messages = [{ role: "user", content: "/model gpt-4o" }];
    const result = detectOverride(messages, "openai/gpt-4o-mini");
    expect(result.detected).toBe(true);
    expect(result.source).toBe("api-field");
    expect(result.modelId).toBe("openai/gpt-4o-mini");
  });

  it("slash-command takes priority over prompt patterns", () => {
    const messages = [{ role: "user", content: "/model claude use gpt-4o" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.source).toBe("slash-command");
  });

  it("detects unconfigured model when providers list is provided", () => {
    const providers: UserProvider[] = [
      {
        id: "openai/gpt-4o",
        isLocal: false,
        tier: ComplexityTier.Medium,
        contextWindow: 128000,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        inputPricePerMToken: 2.5,
        outputPricePerMToken: 10.0,
        avgLatencyMs: 800,
        specialisedFor: [],
        avoidFor: [],
        priorityForTasks: {},
      },
    ];
    const result = detectOverride([], "unknown/model", providers);
    expect(result.detected).toBe(true);
    expect(result.notConfigured).toBe(true);
  });

  it("handles array content in messages", () => {
    const messages = [{ role: "user", content: ["use ", "gpt-4o", " for this"] }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.modelId).toBe("openai/gpt-4o");
  });

  it('handles "with model" pattern', () => {
    const messages = [{ role: "user", content: "answer this with claude-opus" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.source).toBe("prompt");
    expect(result.modelId).toBe("anthropic/claude-opus-4");
  });

  it("case-insensitive slash command", () => {
    const messages = [{ role: "user", content: "/MODEL GPT-4O" }];
    const result = detectOverride(messages);
    expect(result.detected).toBe(true);
    expect(result.modelId).toBe("openai/gpt-4o");
  });
});
