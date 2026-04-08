/**
 * Detailed Routing Decision Test
 * Shows prompt, task detected, complexity, and LLM decision
 */

import { route as routeV2, type RoutingContext } from "./src/routing-engine-v2.js";
import { scoreComplexity } from "./src/complexity-scorer.js";
import { classifyTask } from "./src/task-classifier.js";
import { detectOverride } from "./src/override-detector.js";
import { createIgniteConfig } from "./src/openclaw-providers.js";
import { type IgniteProvider } from "./src/openclaw-providers.js";
import { DEFAULT_ROUTING_CONFIG, type RoutingProfile } from "./src/router/routing-config.js";

const createProvider = (overrides: Partial<IgniteProvider> = {}): IgniteProvider => ({
  id: "minimax/minimax-text-01",
  providerName: "minimax",
  baseUrl: "https://api.minimax.chat/v1",
  isLocal: false,
  tier: "medium" as any,
  contextWindow: 1000000,
  avgLatencyMs: 600,
  supportsVision: true,
  supportsTools: false,
  supportsStreaming: true,
  inputPricePerMToken: 0.1,
  outputPricePerMToken: 0.5,
  priorityForTasks: {},
  ...overrides,
});

const providers: IgniteProvider[] = [
  createProvider({
    id: "ollama/llama3.2:1b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "simple" as any,
    contextWindow: 128000,
    avgLatencyMs: 100,
  }),
  createProvider({
    id: "ollama/llama3.2:3b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "simple" as any,
    contextWindow: 128000,
    avgLatencyMs: 150,
  }),
  createProvider({
    id: "ollama/qwen2.5:3b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "simple" as any,
    contextWindow: 128000,
    avgLatencyMs: 120,
  }),
  createProvider({
    id: "ollama/llama3.1:8b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "medium" as any,
    contextWindow: 128000,
    avgLatencyMs: 400,
  }),
  createProvider({
    id: "ollama/llama3.1:70b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "complex" as any,
    contextWindow: 128000,
    avgLatencyMs: 3000,
  }),
  createProvider({
    id: "ollama/codellama:34b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "complex" as any,
    contextWindow: 128000,
    avgLatencyMs: 2500,
  }),
  createProvider({
    id: "ollama/deepseek-r1:14b",
    providerName: "ollama",
    baseUrl: "http://localhost:11434",
    isLocal: true,
    tier: "reasoning" as any,
    contextWindow: 128000,
    avgLatencyMs: 1800,
  }),
  createProvider({
    id: "minimax/minimax-text-01",
    providerName: "minimax",
    baseUrl: "https://api.minimax.chat/v1",
    isLocal: false,
    tier: "medium" as any,
    contextWindow: 1000000,
    avgLatencyMs: 600,
    supportsVision: true,
  }),
  createProvider({
    id: "minimax/minimax-reasoner",
    providerName: "minimax",
    baseUrl: "https://api.minimax.chat/v1",
    isLocal: false,
    tier: "reasoning" as any,
    contextWindow: 1000000,
    avgLatencyMs: 1200,
  }),
];

const config = createIgniteConfig(providers);

interface TestPrompt {
  prompt: string;
  expectedTier: string;
  hasImages?: boolean;
  hasTools?: boolean;
}

const prompts: TestPrompt[] = [
  // SIMPLE prompts
  { prompt: "hi", expectedTier: "SIMPLE" },
  { prompt: "what is Python", expectedTier: "SIMPLE" },
  { prompt: "translate hello to Spanish", expectedTier: "SIMPLE" },
  { prompt: "thanks", expectedTier: "SIMPLE" },

  // MEDIUM prompts
  { prompt: "how does async/await work in JavaScript", expectedTier: "MEDIUM" },
  { prompt: "compare SQL vs NoSQL databases", expectedTier: "MEDIUM" },
  { prompt: "what are the pros and cons of microservices", expectedTier: "MEDIUM" },
  { prompt: "explain how TCP works", expectedTier: "MEDIUM" },
  { prompt: "help me understand closures in JavaScript", expectedTier: "MEDIUM" },
  { prompt: "what is containerization", expectedTier: "MEDIUM" },

  // COMPLEX prompts
  { prompt: "implement a binary search tree", expectedTier: "COMPLEX" },
  { prompt: "debug why my API calls are failing with CORS", expectedTier: "COMPLEX" },
  { prompt: "refactor this function to be more efficient", expectedTier: "COMPLEX" },
  { prompt: "build a React component with hooks", expectedTier: "COMPLEX" },
  { prompt: "create a REST API with authentication", expectedTier: "COMPLEX" },
  { prompt: "design a database schema for a social network", expectedTier: "COMPLEX" },
  { prompt: "optimize this slow SQL query", expectedTier: "COMPLEX" },
  { prompt: "setup a Kubernetes cluster with monitoring", expectedTier: "COMPLEX" },

  // REASONING prompts
  { prompt: "architect a distributed system", expectedTier: "REASONING" },
  { prompt: "prove that there are infinitely many primes", expectedTier: "REASONING" },
  { prompt: "derive the time complexity of quicksort", expectedTier: "REASONING" },
  { prompt: "architect a system that handles 1M requests per second", expectedTier: "REASONING" },
  { prompt: "prove correctness of binary search", expectedTier: "REASONING" },

  // Override tests
  { prompt: "use qwen for this", expectedTier: "SIMPLE" },
  { prompt: "use minimax-reasoner for this task", expectedTier: "SIMPLE" },

  // Vision test
  { prompt: "analyze this image", expectedTier: "MEDIUM", hasImages: true },

  // Creative
  { prompt: "write me a short poem about coding", expectedTier: "MEDIUM" },

  // Agentic
  { prompt: "search the web for the latest AI news", expectedTier: "SIMPLE", hasTools: true },
];

console.log(`
╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                                        IGNITEROUTER - DETAILED ROUTING DECISIONS                                                                 ║
╠════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║  #  │ Prompt (40 chars)                        │ Task      │ Score │ Tier      │ Override  │ Model Selected                          │ Status ║
`);

let passCount = 0;
let failCount = 0;

for (let i = 0; i < prompts.length; i++) {
  const { prompt, expectedTier, hasImages, hasTools } = prompts[i];

  const messages = [{ role: "user" as const, content: prompt }];
  const context: RoutingContext = { messages };

  const complexityResult = await scoreComplexity(prompt);
  const taskResult = classifyTask(messages, hasTools ? [{}] : undefined);
  const overrideResult = detectOverride(prompt);
  const routingResult = await routeV2(context, config, "auto");

  const tierMatch = complexityResult.tier === expectedTier;
  const status = tierMatch ? "✅" : "❌";

  if (tierMatch) passCount++;
  else failCount++;

  const promptDisplay = prompt.length > 40 ? prompt.substring(0, 37) + "..." : prompt.padEnd(40);
  const taskDisplay = (taskResult.taskType || "chat").padEnd(9);
  const overrideDisplay = overrideResult.detected
    ? ((overrideResult.source || "override") as string).padEnd(9)
    : "none".padEnd(9);
  const modelDisplay = (routingResult.recommendedModel || "N/A").padEnd(40);
  const tierDisplay = complexityResult.tier.padEnd(8);
  const scoreDisplay = complexityResult.score.toFixed(2).padStart(5);

  console.log(
    `║ ${String(i + 1).padStart(2)} │ ${promptDisplay} │ ${taskDisplay} │ ${scoreDisplay} │ ${tierDisplay} │ ${overrideDisplay} │ ${modelDisplay} │ ${status} ║`,
  );
}

console.log(`
╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
`);

console.log(
  `\n📊 Summary: ${passCount} passed, ${failCount} failed (${((passCount / prompts.length) * 100).toFixed(1)}% accuracy)\n`,
);

// Print detailed breakdown by tier
console.log("═".repeat(100) + "\n");
console.log("DETAILED BREAKDOWN BY TIER\n");
console.log("═".repeat(100) + "\n");

const tierGroups: Record<string, number[]> = {
  SIMPLE: [0, 1, 2, 3],
  MEDIUM: [4, 5, 6, 7, 8, 9, 10],
  COMPLEX: [11, 12, 13, 14, 15, 16, 17, 18],
  REASONING: [19, 20, 21, 22, 23],
  SPECIAL: [24, 25, 26, 27, 28],
}; // Total: 29 prompts

for (const [tierName, indices] of Object.entries(tierGroups)) {
  console.log(`\n▓ ${tierName} (${indices.length} prompts):`);
  console.log("─".repeat(100));

  for (const idx of indices) {
    const { prompt, expectedTier, hasImages, hasTools } = prompts[idx];

    const messages = [{ role: "user" as const, content: prompt }];
    const complexityResult = await scoreComplexity(prompt);
    const taskResult = classifyTask(messages, hasTools ? [{}] : undefined);
    const overrideResult = detectOverride(prompt);
    const routingResult = await routeV2({ messages }, config, "auto");

    const match = complexityResult.tier === expectedTier;
    const symbol = match ? "✅" : "❌";

    console.log(`\n  ${symbol} Prompt: "${prompt}"`);
    console.log(
      `     ├─ Task Detected:    ${taskResult.taskType || "chat"} (${taskResult.confidence})`,
    );
    console.log(`     ├─ Complexity Score: ${complexityResult.score.toFixed(2)}`);
    console.log(`     ├─ Tier Classified: ${complexityResult.tier} (expected: ${expectedTier})`);
    console.log(
      `     ├─ Override:        ${overrideResult.detected ? overrideResult.source : "none"}`,
    );
    console.log(`     └─ Model Selected:  ${routingResult.recommendedModel || "N/A"}`);
  }
}

console.log("\n" + "═".repeat(100));
console.log("END OF REPORT");
console.log("═".repeat(100) + "\n");
