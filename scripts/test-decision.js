#!/usr/bin/env node

import { route } from "../dist/index.js";

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
  console.log("=".repeat(110));
  console.log("IgniteRouter Decision-Only Mode - Routing Test Results");
  console.log("=".repeat(110));
  console.log();

  const header =
    "| #  | Prompt                                    | Expected  | Tier       | Recommended Model                |";
  console.log(header);
  console.log(
    "|---|------------------------------------------|-----------|------------|-----------------------------------|",
  );

  let correct = 0;

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

    const isCorrect = tier === expected;
    if (isCorrect) correct++;
    const status = isCorrect ? "✅" : "⚠️";

    console.log(
      `| ${String(i + 1).padEnd(2)} | ${prompt.substring(0, 40).padEnd(40)} | ${expected.padEnd(9)} | ${tier.padEnd(10)} | ${model.padEnd(33)} |`,
    );
  }

  console.log();
  console.log("=".repeat(110));
  console.log(
    `Results: ${correct}/${testPrompts.length} correct (${Math.round((correct / testPrompts.length) * 100)}%)`,
  );
  console.log("=".repeat(110));
}

runTests().catch(console.error);
