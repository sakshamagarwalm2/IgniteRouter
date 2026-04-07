#!/usr/bin/env node

const TEST_PROMPTS = [
  // SIMPLE tier prompts - basic questions
  { prompt: "What is 2+2?", tier: "SIMPLE", model: null },
  { prompt: "What is the capital of France?", tier: "SIMPLE", model: null },
  { prompt: "Hello, how are you?", tier: "SIMPLE", model: null },
  { prompt: "Define photosynthesis", tier: "SIMPLE", model: null },
  { prompt: "What is 2+2?", tier: "SIMPLE", model: "deepseek/deepseek-chat" }, // with model override
  { prompt: "What is the capital of France?", tier: "SIMPLE", model: "xiaomi/mimo-v2-flash" }, // with model override

  // MEDIUM tier prompts - explanations and comparisons
  { prompt: "Explain how TCP/IP works", tier: "MEDIUM", model: null },
  { prompt: "Compare microservices vs monolith architecture", tier: "MEDIUM", model: null },
  { prompt: "What are the pros and cons of TypeScript?", tier: "MEDIUM", model: null },
  { prompt: "Summarize this article about AI", tier: "MEDIUM", model: null },
  { prompt: "Explain how TCP/IP works", tier: "MEDIUM", model: "deepseek/deepseek-chat" }, // with model override
  { prompt: "Compare microservices vs monolith", tier: "MEDIUM", model: "openai/gpt-4o-mini" }, // with model override

  // COMPLEX tier prompts - code and technical tasks
  { prompt: "Build a React component that displays a todo list", tier: "COMPLEX", model: null },
  { prompt: "Write a Python script to parse CSV files", tier: "COMPLEX", model: null },
  { prompt: "Design a database schema for an e-commerce site", tier: "COMPLEX", model: null },
  { prompt: "Create a REST API with authentication", tier: "COMPLEX", model: null },
  { prompt: "Build a React todo component", tier: "COMPLEX", model: "deepseek/deepseek-chat" }, // with model override
  { prompt: "Write a Python CSV parser", tier: "COMPLEX", model: "anthropic/claude-sonnet-4.6" }, // with model override

  // REASONING tier prompts - complex analysis and derivation
  { prompt: "Prove that sqrt(2) is irrational", tier: "REASONING", model: null },
  { prompt: "Derive the formula for compound interest", tier: "REASONING", model: null },
  {
    prompt: "Analyze the tradeoffs between OAuth2 and JWT for authentication",
    tier: "REASONING",
    model: null,
  },
  {
    prompt: "Step by step: How would you optimize a slow database query?",
    tier: "REASONING",
    model: null,
  },
  { prompt: "Prove sqrt(2) is irrational", tier: "REASONING", model: "deepseek/deepseek-reasoner" }, // with model override
  {
    prompt: "Analyze OAuth2 vs JWT tradeoffs",
    tier: "REASONING",
    model: "anthropic/claude-opus-4.6",
  }, // with model override
];

const PROXY_URL = "http://localhost:8402";

async function testRouting(testCase) {
  const start = Date.now();
  const modelParam = testCase.model || "igniterouter/auto";

  try {
    const response = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelParam,
        messages: [{ role: "user", content: testCase.prompt }],
        max_tokens: 50,
      }),
    });

    const latency = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        prompt: testCase.prompt.substring(0, 40),
        expectedTier: testCase.tier,
        requestedModel: modelParam,
        detectedTier: "-",
        calledApi: "-",
        calledModel: "-",
        status: response.status,
        success: false,
        error: errorBody.substring(0, 80),
        latency,
      };
    }

    const data = await response.json();

    // Extract headers
    const detectedTier = response.headers.get("x-IgniteRouter-Tier") || "-";
    const calledApi = response.headers.get("x-IgniteRouter-Model") || "-";
    const calledModel = data.model || "-";

    return {
      prompt: testCase.prompt.substring(0, 40),
      expectedTier: testCase.tier,
      requestedModel: modelParam,
      detectedTier,
      calledApi,
      calledModel,
      status: response.status,
      success: true,
      error: null,
      latency,
    };
  } catch (err) {
    return {
      prompt: testCase.prompt.substring(0, 40),
      expectedTier: testCase.tier,
      requestedModel: modelParam,
      detectedTier: "-",
      calledApi: "-",
      calledModel: "-",
      status: 0,
      success: false,
      error: err.message,
      latency: Date.now() - start,
    };
  }
}

function formatTable(headers, rows) {
  const colWidths = headers.map((h, i) => {
    const maxContent = Math.max(h.length, ...rows.map((r) => String(r[i] || "").length));
    return Math.min(maxContent, 30); // Cap at 30 chars
  });

  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");

  const rowsFormatted = rows.map((row) =>
    row.map((cell, i) => String(cell).substring(0, colWidths[i]).padEnd(colWidths[i])).join(" | "),
  );

  return [headerRow, separator, ...rowsFormatted].join("\n");
}

async function runTests() {
  console.log("=".repeat(100));
  console.log("IgniteRouter Tier Classification & Routing Test");
  console.log("=".repeat(100));
  console.log();

  // Check proxy health
  try {
    const healthRes = await fetch(`${PROXY_URL}/health`);
    if (healthRes.ok) {
      const health = await healthRes.json();
      console.log("Proxy Status: RUNNING");
      console.log(`  Port: ${PROXY_URL.replace("http://localhost:", "")}`);
      console.log(`  Providers: ${health.providers || "N/A"}`);
      console.log(`  Version: ${health.version || "N/A"}`);
      console.log();
    }
  } catch (e) {
    console.log("Proxy Status: NOT RUNNING");
    console.log("Start proxy with: openclaw gateway");
    console.log();
    process.exit(1);
  }

  console.log("=".repeat(100));
  console.log("Running Tests...");
  console.log("=".repeat(100));
  console.log();

  const results = [];

  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const testCase = TEST_PROMPTS[i];
    const testNum = i + 1;
    const modelOverride = testCase.model ? ` [model: ${testCase.model}]` : "";
    console.log(
      `[${testNum}/${TEST_PROMPTS.length}] Testing: "${testCase.prompt.substring(0, 35)}..."${modelOverride}`,
    );

    const result = await testRouting(testCase);
    results.push(result);

    // Show immediate result
    const statusSymbol = result.success ? "✅" : "❌";
    const tierMatch = result.expectedTier === result.detectedTier ? "✓" : "✗";
    console.log(
      `       -> Detected: ${result.detectedTier} ${tierMatch}, Called: ${result.calledApi}, Status: ${result.status} ${statusSymbol}`,
    );
    console.log();

    // Small delay between tests
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log();
  console.log("=".repeat(100));
  console.log("RESULTS TABLE");
  console.log("=".repeat(100));
  console.log();

  const headers = [
    "#",
    "Prompt",
    "Expected",
    "Detected",
    "Requested",
    "Called API/Model",
    "Status",
    "Latency",
  ];
  const rows = results.map((r, i) => [
    String(i + 1),
    r.prompt.length > 25 ? r.prompt.substring(0, 25) + "..." : r.prompt,
    r.expectedTier,
    r.detectedTier,
    r.requestedModel.length > 20 ? "..." + r.requestedModel.substring(17) : r.requestedModel,
    r.calledApi.length > 20 ? "..." + r.calledApi.substring(17) : r.calledApi,
    r.success ? "OK" : `FAIL(${r.status})`,
    r.latency + "ms",
  ]);

  console.log(formatTable(headers, rows));
  console.log();

  // Summary
  console.log("=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log();

  // Overall stats
  const total = results.length;
  const successful = results.filter((r) => r.success).length;
  const tierCorrect = results.filter((r) => r.expectedTier === r.detectedTier).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`Total Tests: ${total}`);
  console.log(`Successful:  ${successful} (${((successful / total) * 100).toFixed(1)}%)`);
  console.log(`Failed:      ${failed} (${((failed / total) * 100).toFixed(1)}%)`);
  console.log(`Tier Match:  ${tierCorrect} (${((tierCorrect / total) * 100).toFixed(1)}%)`);
  console.log();

  // Tier breakdown
  console.log("Tier Breakdown:");
  console.log("-".repeat(50));
  const tiers = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"];
  for (const tier of tiers) {
    const tierTests = results.filter((r) => r.expectedTier === tier);
    const tierSuccess = tierTests.filter((r) => r.success).length;
    const tierCorrect = tierTests.filter((r) => r.expectedTier === r.detectedTier).length;
    console.log(
      `  ${tier.padEnd(10)}: ${tierTests.length} tests, ${tierSuccess} OK, ${tierCorrect} tier-match`,
    );
  }

  console.log();

  // Model override tests
  console.log("Model Override Tests:");
  console.log("-".repeat(50));
  const overrideTests = results.filter((r) => r.requestedModel !== "igniterouter/auto");
  for (const test of overrideTests) {
    const status = test.success ? "✅" : "❌";
    console.log(
      `  ${test.prompt.substring(0, 30).padEnd(30)} -> ${test.requestedModel.substring(0, 25).padEnd(25)} ${status}`,
    );
  }

  console.log();
  console.log("=".repeat(100));
  console.log("Test Complete");
  console.log("=".repeat(100));
}

runTests().catch(console.error);
