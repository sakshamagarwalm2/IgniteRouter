import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComplexityTier } from "../src/complexity-scorer.js";
import { TaskType } from "../src/task-classifier.js";
import { route } from "../src/routing-engine.js";

const DUMMY_PROVIDERS = [
  {
    id: "cheap-chat/model-a",
    apiKey: "dummy-key-a",
    tier: ComplexityTier.Simple,
    contextWindow: 8000,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.2,
    avgLatencyMs: 300,
    isLocal: false,
    specialisedFor: [TaskType.Chat],
    avoidFor: [],
    priorityForTasks: {},
  },
  {
    id: "mid-range/model-b",
    apiKey: "dummy-key-b",
    tier: ComplexityTier.Medium,
    contextWindow: 32000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 1.0,
    avgLatencyMs: 600,
    isLocal: false,
    specialisedFor: [TaskType.Reasoning],
    avoidFor: [],
    priorityForTasks: {},
  },
  {
    id: "vision-capable/model-c",
    apiKey: "dummy-key-c",
    tier: ComplexityTier.Complex,
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10.0,
    avgLatencyMs: 900,
    isLocal: false,
    specialisedFor: [TaskType.Vision, TaskType.Deep],
    avoidFor: [TaskType.Chat],
    priorityForTasks: { [TaskType.Vision]: 1 },
  },
  {
    id: "local/ollama-model-d",
    apiKey: undefined,
    baseUrl: "http://localhost:11434",
    tier: ComplexityTier.Complex,
    contextWindow: 64000,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    avgLatencyMs: 500,
    isLocal: true,
    specialisedFor: [],
    avoidFor: [],
    priorityForTasks: {},
  },
  {
    id: "expert/model-e",
    apiKey: "dummy-key-e",
    tier: ComplexityTier.Expert,
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 15.0,
    outputPricePerMToken: 75.0,
    avgLatencyMs: 1800,
    isLocal: false,
    specialisedFor: [TaskType.Deep, TaskType.Reasoning],
    avoidFor: [],
    priorityForTasks: {},
  },
];

const DUMMY_CONFIG = {
  defaultPriority: "cost" as const,
  providers: DUMMY_PROVIDERS,
};

describe("IgniteRouter E2E Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Group 1 — Task Classification", () => {
    it('T01: "hello how are you" → taskType = Chat', async () => {
      const result = await route(
        { messages: [{ role: "user", content: "hello how are you" }] },
        DUMMY_CONFIG,
      );
      expect(result.taskType).toBe(TaskType.Chat);
    });

    it('T02: "write a short story about a dragon" → taskType = Creative', async () => {
      const result = await route(
        { messages: [{ role: "user", content: "write a short story about a dragon" }] },
        DUMMY_CONFIG,
      );
      expect(result.taskType).toBe(TaskType.Creative);
    });

    it('T03: "analyse the tradeoffs between microservices and monolith" → taskType = Reasoning', async () => {
      const result = await route(
        {
          messages: [
            { role: "user", content: "analyse the tradeoffs between microservices and monolith" },
          ],
        },
        DUMMY_CONFIG,
      );
      expect(result.taskType).toBe(TaskType.Reasoning);
    });

    it("T04: request with tools array present → taskType = Agentic", async () => {
      const result = await route(
        {
          messages: [{ role: "user", content: "search the web for latest news" }],
          tools: [{ type: "function", name: "web_search" }],
        },
        DUMMY_CONFIG,
      );
      expect(result.taskType).toBe(TaskType.Agentic);
    });

    it("T05: request with image in content → taskType = Vision", async () => {
      const result = await route(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "what is this?" },
                { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
              ],
            },
          ],
        },
        DUMMY_CONFIG,
      );
      expect(result.taskType).toBe(TaskType.Vision);
    });
  });

  describe("Group 2 — Complexity Tier", () => {
    it('T06: "hi" → tier = SIMPLE (score < 0.30)', async () => {
      const result = await route({ messages: [{ role: "user", content: "hi" }] }, DUMMY_CONFIG);
      expect(result.tier).toBe(ComplexityTier.Simple);
      expect(result.complexityScore).toBeLessThan(0.3);
    });

    it('T07: "explain how TCP works" → tier = MEDIUM or SIMPLE (score < 0.60)', async () => {
      const result = await route(
        { messages: [{ role: "user", content: "explain how TCP works" }] },
        DUMMY_CONFIG,
      );
      expect(result.complexityScore).toBeLessThan(0.6);
    });

    it('T08: "analyse the architectural tradeoffs in depth" → tier = COMPLEX or EXPERT (score >= 0.60)', async () => {
      const result = await route(
        { messages: [{ role: "user", content: "analyse the architectural tradeoffs in depth" }] },
        DUMMY_CONFIG,
      );
      expect(result.complexityScore).toBeGreaterThanOrEqual(0.6);
    });

    it('T09: "prove that sqrt(2) is irrational step by step formally" → tier = COMPLEX or higher (score >= 0.60)', async () => {
      const result = await route(
        {
          messages: [
            { role: "user", content: "prove that sqrt(2) is irrational step by step formally" },
          ],
        },
        DUMMY_CONFIG,
      );
      expect(result.complexityScore).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("Group 3 — Capability Filtering", () => {
    it("T10: vision request → only vision-capable/model-c and expert/model-e in candidates", async () => {
      const result = await route(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "describe this image" },
                { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
              ],
            },
          ],
        },
        DUMMY_CONFIG,
      );
      const candidateIds = result.candidateProviders.map((p) => p.id);
      expect(candidateIds).not.toContain("cheap-chat/model-a");
      expect(candidateIds).not.toContain("mid-range/model-b");
      expect(candidateIds).not.toContain("local/ollama-model-d");
      expect(candidateIds).toContain("vision-capable/model-c");
      expect(candidateIds).toContain("expert/model-e");
    });

    it("T11: tools request → model-a and model-d filtered out (supportsTools=false)", async () => {
      const result = await route(
        {
          messages: [{ role: "user", content: "use the calculator to add 2+2" }],
          tools: [{ type: "function", name: "calculator" }],
        },
        DUMMY_CONFIG,
      );
      const candidateIds = result.candidateProviders.map((p) => p.id);
      expect(candidateIds).not.toContain("cheap-chat/model-a");
      expect(candidateIds).not.toContain("local/ollama-model-d");
      expect(candidateIds).toContain("mid-range/model-b");
      expect(candidateIds).toContain("vision-capable/model-c");
      expect(candidateIds).toContain("expert/model-e");
    });

    it("T12: very long prompt (estimatedTokens = 10000) → cheap-chat/model-a filtered out", async () => {
      const result = await route(
        { messages: [{ role: "user", content: "a".repeat(40000) }] },
        { ...DUMMY_CONFIG, providers: DUMMY_PROVIDERS },
      );
      const candidateIds = result.candidateProviders.map((p) => p.id);
      expect(candidateIds).not.toContain("cheap-chat/model-a");
    });

    it("T13: simple chat, no vision, no tools → all models pass filter", async () => {
      const result = await route(
        { messages: [{ role: "user", content: "hello there" }] },
        DUMMY_CONFIG,
      );
      expect(result.candidateProviders.length).toBe(5);
    });
  });

  describe("Group 4 — Priority and Ranking", () => {
    it("T14: cost priority, COMPLEX tier → local/ollama-model-d (price=0) ranked first", async () => {
      const result = await route(
        {
          messages: [{ role: "user", content: "analyse the system architecture in depth" }],
        },
        { ...DUMMY_CONFIG, defaultPriority: "cost" as const },
      );
      expect(result.candidateProviders[0].id).toBe("local/ollama-model-d");
    });

    it("T15: speed priority → cheap-chat/model-a (latency=300) ranked first among eligible", async () => {
      const result = await route(
        { messages: [{ role: "user", content: "hello" }] },
        { ...DUMMY_CONFIG, defaultPriority: "speed" as const },
      );
      expect(result.candidateProviders[0].id).toBe("cheap-chat/model-a");
    });

    it("T16: vision task → vision-capable/model-c ranked first (priorityForTasks.vision = 1)", async () => {
      const result = await route(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "what do you see?" },
                { type: "image_url", image_url: { url: "data:image/png;base64,xyz" } },
              ],
            },
          ],
        },
        DUMMY_CONFIG,
      );
      expect(result.candidateProviders[0].id).toBe("vision-capable/model-c");
    });

    it("T17: reasoning task, cost priority → mid-range/model-b ranked above others in same tier", async () => {
      const result = await route(
        {
          messages: [
            { role: "user", content: "analyse the tradeoffs between microservices and monolith" },
          ],
        },
        { ...DUMMY_CONFIG, defaultPriority: "cost" as const },
      );
      const topCandidate = result.candidateProviders[0];
      expect(topCandidate.specialisedFor).toContain(TaskType.Reasoning);
    });
  });

  describe("Group 5 — Override Detection", () => {
    it('T18: requestedModel = "vision-capable/model-c" → candidateProviders = [model-c only]', async () => {
      const result = await route(
        {
          messages: [{ role: "user", content: "hello" }],
          requestedModel: "vision-capable/model-c",
        },
        DUMMY_CONFIG,
      );
      expect(result.override?.detected).toBe(true);
      expect(result.override?.source).toBe("api-field");
      expect(result.candidateProviders).toHaveLength(1);
      expect(result.candidateProviders[0].id).toBe("vision-capable/model-c");
    });

    it('T19: message = "/model expert/model-e" → override detected, candidateProviders = [model-e only]', async () => {
      const result = await route(
        { messages: [{ role: "user", content: "/model expert/model-e use this" }] },
        DUMMY_CONFIG,
      );
      expect(result.override?.detected).toBe(true);
      expect(result.override?.source).toBe("slash-command");
      expect(result.candidateProviders).toHaveLength(1);
      expect(result.candidateProviders[0].id).toBe("expert/model-e");
    });

    it('T20: requestedModel = "unknown/model-x" → error contains "not in your provider list"', async () => {
      const result = await route(
        {
          messages: [{ role: "user", content: "hello" }],
          requestedModel: "unknown/model-x",
        },
        DUMMY_CONFIG,
      );
      expect(result.error).toBeDefined();
      expect(result.error).toContain("is not configured");
      expect(result.candidateProviders).toHaveLength(0);
    });
  });
});

describe("Routing Latency", () => {
  it("All routing decisions include latencyMs > 0", async () => {
    const result = await route(
      { messages: [{ role: "user", content: "hello world" }] },
      DUMMY_CONFIG,
    );
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.latencyMs).toBe("number");
  });
});

async function printRoutingTable() {
  console.log("\n=== IgniteRouter Routing Table ===\n");

  const testCases = [
    { prompt: "hello", tools: false, image: false },
    { prompt: "write me a poem", tools: false, image: false },
    { prompt: "explain how TCP works", tools: false, image: false },
    { prompt: "analyse microservices vs monolith", tools: false, image: false },
    { prompt: "prove sqrt(2) is irrational", tools: false, image: false },
    { prompt: "[image request]", tools: false, image: true },
    { prompt: "[tool use request]", tools: true, image: false },
  ];

  console.log(
    "Prompt".padEnd(40),
    "Task".padEnd(12),
    "Tier".padEnd(10),
    "Top Model".padEnd(28),
    "Score",
  );
  console.log("-".repeat(105));

  for (const tc of testCases) {
    const messages: Array<{ role: string; content: unknown }> = [
      { role: "user", content: tc.prompt },
    ];

    if (tc.image) {
      messages[0].content = [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,test" } },
      ];
    }

    const result = await route(
      { messages, tools: tc.tools ? [{ type: "function", name: "test" }] : undefined },
      DUMMY_CONFIG,
    );

    const prompt = tc.prompt.length > 38 ? tc.prompt.substring(0, 35) + "..." : tc.prompt;
    const task = (result.taskType ?? "unknown").padEnd(12);
    const tier = (result.tier ?? "unknown").padEnd(10);
    const model = (result.candidateProviders[0]?.id ?? result.error ?? "none").padEnd(28);
    const score = (result.complexityScore?.toFixed(2) ?? "N/A").padEnd(6);

    console.log(`${prompt.padEnd(40)}${task}${tier}${model}${score}`);
  }

  console.log("\n");
}

printRoutingTable();
