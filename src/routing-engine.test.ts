import { describe, expect, it, vi, beforeEach } from "vitest";
import { route } from "./routing-engine.js";
import { ComplexityTier } from "./complexity-scorer.js";
import { TaskType } from "./task-classifier.js";
import { UserProvider } from "./user-providers.js";

const createProvider = (overrides: Partial<UserProvider> = {}): UserProvider => ({
  id: "test/model",
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
  ...overrides,
});

describe("route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Override via api field → candidateProviders has exactly that one provider", async () => {
    const providers = [
      createProvider({ id: "openai/gpt-4o" }),
      createProvider({ id: "anthropic/claude-sonnet-4" }),
    ];

    const result = await route(
      {
        messages: [{ role: "user", content: "hello" }],
        requestedModel: "openai/gpt-4o",
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.override?.detected).toBe(true);
    expect(result.override?.source).toBe("api-field");
    expect(result.candidateProviders).toHaveLength(1);
    expect(result.candidateProviders[0].id).toBe("openai/gpt-4o");
  });

  it("Override with unconfigured model → error message returned", async () => {
    const providers = [createProvider({ id: "openai/gpt-4o" })];

    const result = await route(
      {
        messages: [{ role: "user", content: "hello" }],
        requestedModel: "unknown/model",
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.error).toContain("unknown/model");
    expect(result.error).toContain("not in your provider list");
    expect(result.candidateProviders).toHaveLength(0);
  });

  it("Simple chat prompt with 3 providers → SIMPLE tier candidates ranked correctly", async () => {
    const providers = [
      createProvider({ id: "openai/gpt-4o", tier: ComplexityTier.Complex }),
      createProvider({ id: "openai/gpt-4o-mini", tier: ComplexityTier.Simple }),
      createProvider({ id: "anthropic/claude-haiku-4", tier: ComplexityTier.Medium }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "hi" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.candidateProviders.length).toBeGreaterThan(0);
    expect(result.tier).toBe(ComplexityTier.Simple);
  });

  it("Vision prompt with mixed providers → non-vision providers filtered out", async () => {
    const providers = [
      createProvider({ id: "openai/gpt-4o", supportsVision: true }),
      createProvider({ id: "openai/gpt-4o-mini", supportsVision: false }),
      createProvider({ id: "anthropic/claude-opus-4", supportsVision: true }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
          },
        ],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.selection?.filtered.length).toBe(1);
    expect(result.selection?.filterReasons.get("openai/gpt-4o-mini")).toContain("vision");
    expect(result.candidateProviders.length).toBe(2);
  });

  it("Tools request with no-tools provider → filtered out", async () => {
    const providers = [
      createProvider({ id: "openai/gpt-4o", supportsTools: true }),
      createProvider({ id: "deepseek/deepseek-reasoner", supportsTools: false }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "help me" }],
        tools: [{ type: "function", name: "search" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.selection?.filtered.length).toBe(1);
    expect(result.selection?.filterReasons.get("deepseek/deepseek-reasoner")).toContain("tool");
  });

  it("Cost priority → cheapest provider ranked first", async () => {
    const providers = [
      createProvider({
        id: "expensive/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 5.0,
      }),
      createProvider({
        id: "cheap/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 0.1,
      }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "explain this" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.candidateProviders.length).toBe(2);
    expect(result.candidateProviders[0].id).toBe("cheap/model");
  });

  it("Speed priority → fastest provider ranked first", async () => {
    const providers = [
      createProvider({
        id: "slow/model",
        tier: ComplexityTier.Medium,
        avgLatencyMs: 2000,
      }),
      createProvider({
        id: "fast/model",
        tier: ComplexityTier.Medium,
        avgLatencyMs: 300,
      }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "explain this" }],
      },
      { defaultPriority: "speed", providers },
    );

    expect(result.candidateProviders.length).toBe(2);
    expect(result.candidateProviders[0].id).toBe("fast/model");
  });

  it("specialisedFor task → specialised provider ranked above cheaper generic", async () => {
    const providers = [
      createProvider({
        id: "generic/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 0.1,
        specialisedFor: [],
      }),
      createProvider({
        id: "specialised/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 2.0,
        specialisedFor: [TaskType.Creative],
      }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "write a story about dragons" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.candidateProviders.length).toBe(2);
    expect(result.candidateProviders[0].id).toBe("specialised/model");
  });

  it("priorityForTasks rank 1 → that provider always first regardless of cost", async () => {
    const providers = [
      createProvider({
        id: "expensive/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 10.0,
        priorityForTasks: { [TaskType.Reasoning]: 1 },
      }),
      createProvider({
        id: "cheap/model",
        tier: ComplexityTier.Medium,
        inputPricePerMToken: 0.1,
        priorityForTasks: { [TaskType.Reasoning]: 2 },
      }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "analyse this data" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.candidateProviders.length).toBe(2);
    expect(result.candidateProviders[0].id).toBe("expensive/model");
  });

  it("All providers filtered by capability → error returned, no candidates", async () => {
    const providers = [
      createProvider({
        id: "no-vision/model",
        supportsVision: false,
      }),
      createProvider({
        id: "no-tools/model",
        supportsTools: false,
      }),
    ];

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "analyse this" },
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
            ],
          },
        ],
        tools: [{ type: "function", name: "search" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.error).toBeDefined();
    expect(result.candidateProviders).toHaveLength(0);
    expect(result.selection?.candidates).toHaveLength(0);
  });

  it("returns task type and complexity tier", async () => {
    const providers = [createProvider({ id: "test/model" })];
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "prove that there are infinite primes" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.taskType).toBeDefined();
    expect(result.tier).toBeDefined();
    expect(result.complexityScore).toBeDefined();
  });

  it("includes latencyMs in result", async () => {
    const providers = [createProvider({ id: "test/model" })];
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("no server"));

    const result = await route(
      {
        messages: [{ role: "user", content: "hello" }],
      },
      { defaultPriority: "cost", providers },
    );

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
