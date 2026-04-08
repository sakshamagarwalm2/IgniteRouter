#!/usr/bin/env node

import { route, scoreComplexity } from "../dist/index.js";

const providers = [
  {
    id: "deepseek/deepseek-chat",
    providerName: "deepseek",
    baseUrl: "https://api.deepseek.com",
    tier: "MEDIUM",
    supportsTools: true,
    supportsVision: false,
    contextWindow: 131072,
    inputPricePerMToken: 0.28,
    outputPricePerMToken: 0.42,
    avgLatencyMs: 1000,
  },
  {
    id: "deepseek/deepseek-reasoner",
    providerName: "deepseek",
    baseUrl: "https://api.deepseek.com",
    tier: "REASONING",
    supportsTools: false,
    supportsVision: false,
    contextWindow: 131072,
    inputPricePerMToken: 0.28,
    outputPricePerMToken: 0.42,
    avgLatencyMs: 1000,
  },
  {
    id: "xiaomi/mimo-v2-flash",
    providerName: "xiaomi",
    baseUrl: "https://api.xiaomimimo.com/v1",
    tier: "SIMPLE",
    supportsTools: true,
    supportsVision: false,
    contextWindow: 262144,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    avgLatencyMs: 1000,
  },
  {
    id: "mistral/mistral-large-latest",
    providerName: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    tier: "COMPLEX",
    supportsTools: true,
    supportsVision: true,
    contextWindow: 262144,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 1.5,
    avgLatencyMs: 1000,
  },
];

const testPrompts = [
  { prompt: "What is 2+2?", expected: "SIMPLE" },
  { prompt: "What is the capital of France?", expected: "SIMPLE" },
  { prompt: "Hello, how are you?", expected: "SIMPLE" },
  { prompt: "Explain TCP/IP", expected: "MEDIUM" },
  { prompt: "Compare microservices vs monolith", expected: "MEDIUM" },
  { prompt: "Build a React component", expected: "COMPLEX" },
  { prompt: "Write a Python script", expected: "COMPLEX" },
  { prompt: "Prove sqrt(2) is irrational", expected: "REASONING" },
  { prompt: "Derive compound interest formula", expected: "REASONING" },
];

async function runTests() {
  console.log("=".repeat(120));
  console.log("IgniteRouter Decision-Only Mode - Routing Test Results");
  console.log("=".repeat(120));
  console.log();

  console.log("Checking RouteLLM availability...");
  const routellmAvailable = await fetch("http://localhost:8500/health", { method: "GET" })
    .then((r) => r.ok)
    .catch(() => false);
  console.log(
    `RouteLLM: ${routellmAvailable ? "✅ RUNNING" : "❌ NOT RUNNING (using keyword fallback)"}`,
  );
  console.log();

  // Test individual prompts with scoring method
  console.log("Complexity Scoring Test:");
  console.log(
    "| Prompt                                    | Score  | Tier       | Method        |",
  );
  console.log("|------------------------------------------|--------|------------|---------------|");

  for (const { prompt, expected } of testPrompts) {
    const scoreResult = await scoreComplexity(prompt);
    console.log(
      `| ${prompt.substring(0, 40).padEnd(40)} | ${String(scoreResult.score).padEnd(5)} | ${scoreResult.tier.padEnd(10)} | ${scoreResult.method.padEnd(13)} |`,
    );
  }

  console.log();
  console.log("=".repeat(120));
  console.log("Routing Decision Test:");
  console.log("=".repeat(120));

  const header =
    "| #  | Prompt                                    | Expected  | Tier       | Method        | Recommended Model                |";
  console.log(header);
  console.log(
    "|---|------------------------------------------|-----------|------------|---------------|-----------------------------------|",
  );

  let correct = 0;
  let methodsUsed = { routellm: 0, "keyword-fallback": 0 };

  for (let i = 0; i < testPrompts.length; i++) {
    const { prompt, expected } = testPrompts[i];
    const start = Date.now();

    const result = await route(
      {
        messages: [{ role: "user", content: prompt }],
      },
      {
        defaultPriority: "cost",
        providers,
      },
    );

    const latency = Date.now() - start;
    const model = result.candidateProviders[0]?.id || "NONE";
    const tier = result.tier || "UNKNOWN";
    const method = result.complexityScore
      ? result.complexityScore > 0.9
        ? "routellm"
        : "keyword"
      : "N/A";

    // Track method
    const scoreResult = await scoreComplexity(prompt);
    methodsUsed[scoreResult.method] = (methodsUsed[scoreResult.method] || 0) + 1;

    const isCorrect = tier === expected;
    if (isCorrect) correct++;
    const status = isCorrect ? "✅" : "⚠️";

    console.log(
      `| ${String(i + 1).padEnd(2)} | ${prompt.substring(0, 40).padEnd(40)} | ${expected.padEnd(9)} | ${tier.padEnd(10)} | ${String(scoreResult.method).padEnd(13)} | ${model.padEnd(33)} |`,
    );
  }

  console.log();
  console.log("=".repeat(120));
  console.log(
    `Results: ${correct}/${testPrompts.length} correct (${Math.round((correct / testPrompts.length) * 100)}%)`,
  );
  console.log(
    `Method usage: ${Object.entries(methodsUsed)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}`,
  );
  console.log("=".repeat(120));
}

runTests().catch(console.error);
