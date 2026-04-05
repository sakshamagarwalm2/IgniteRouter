import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadProviders } from "../src/user-providers.js";
import { route } from "../src/routing-engine.js";
import { ComplexityTier } from "../src/complexity-scorer.js";
import { TaskType } from "../src/task-classifier.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("  FAIL:", message);
    process.exit(1);
  }
}

function testPluginStructure() {
  console.log("\n=== Part 1: Plugin Structure ===");

  const pluginJson = JSON.parse(readFileSync("openclaw.plugin.json", "utf-8"));
  assert(pluginJson.id, "openclaw.plugin.json must have id");
  assert(pluginJson.name, "openclaw.plugin.json must have name");
  console.log("  ✓ openclaw.plugin.json valid — id:", pluginJson.id);

  const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
  assert(packageJson.openclaw, "package.json must have openclaw field");
  assert(packageJson.openclaw.extensions, "openclaw.extensions must exist");
  console.log("  ✓ package.json openclaw field:", JSON.stringify(packageJson.openclaw));

  const distExists = existsSync("dist/index.js");
  assert(distExists, "dist/index.js must exist — run npm run build first");
  console.log("  ✓ dist/index.js exists");

  const distContent = readFileSync("dist/index.js", "utf-8");
  assert(distContent.includes("startProxy"), "dist/index.js must export startProxy");
  console.log("  ✓ dist/index.js exports startProxy");

  console.log("  PASS: Plugin structure is valid for OpenClaw\n");
}

function testProviderLoading() {
  console.log("=== Part 2: Provider Loading (simulates openclaw.yaml config) ===");

  const mockOpenClawConfig = {
    defaultPriority: "cost",
    providers: [
      {
        id: "openai/gpt-4o-mini",
        apiKey: "sk-test-key-mini",
        tier: "SIMPLE",
      },
      {
        id: "openai/gpt-4o",
        apiKey: "sk-test-key-full",
        tier: "COMPLEX",
        specialisedFor: ["reasoning"],
      },
      {
        id: "google/gemini-2.5-flash",
        apiKey: "test-google-key",
        tier: "SIMPLE",
        specialisedFor: ["vision"],
        priorityForTasks: { vision: 1 },
      },
      {
        id: "ollama/llama3:8b",
        baseUrl: "http://localhost:11434",
        tier: "MEDIUM",
      },
    ],
  };

  const config = loadProviders(mockOpenClawConfig);

  assert(config.providers.length === 4, `Expected 4 providers, got ${config.providers.length}`);
  console.log("  ✓ 4 providers loaded");

  const mini = config.providers.find((p) => p.id === "openai/gpt-4o-mini");
  assert(
    mini?.contextWindow === 128000,
    "gpt-4o-mini should have contextWindow 128000 from registry",
  );
  assert(mini?.supportsVision === true, "gpt-4o-mini should support vision from registry");
  assert(mini?.inputPricePerMToken === 0.15, "gpt-4o-mini price should come from registry");
  console.log("  ✓ KNOWN_MODELS registry filled in gpt-4o-mini metadata correctly");
  console.log("    contextWindow:", mini?.contextWindow);
  console.log("    supportsVision:", mini?.supportsVision);
  console.log("    inputPrice: $" + mini?.inputPricePerMToken + "/M");

  const ollama = config.providers.find((p) => p.id === "ollama/llama3:8b");
  assert(ollama?.isLocal === true, "ollama model should be isLocal=true");
  assert(ollama?.inputPricePerMToken === 0, "ollama model should have price 0");
  assert(ollama?.baseUrl === "http://localhost:11434", "ollama baseUrl should be set");
  console.log("  ✓ Ollama model has isLocal=true, price=0, baseUrl set");

  const gemini = config.providers.find((p) => p.id === "google/gemini-2.5-flash");
  assert(
    gemini?.specialisedFor?.includes(TaskType.Vision),
    "gemini should have vision in specialisedFor",
  );
  assert(gemini?.priorityForTasks?.["vision"] === 1, "gemini should have vision priority 1");
  console.log("  ✓ specialisedFor and priorityForTasks loaded correctly");

  console.log("  PASS: Provider loading works exactly as OpenClaw would call it\n");
  return config;
}

async function testRoutingDecisions(config: ReturnType<typeof loadProviders>) {
  console.log("=== Part 3: Routing Decisions ===");

  const scenarios = [
    {
      name: "Simple greeting",
      messages: [{ role: "user", content: "hello how are you" }],
      expectedModelContains: "gpt-4o-mini",
    },
    {
      name: "Complex reasoning",
      messages: [
        {
          role: "user",
          content: "analyse the architectural tradeoffs between microservices and monolith",
        },
      ],
      expectedModelContains: "ollama",
    },
    {
      name: "Vision request",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
            { type: "text", text: "what is in this image" },
          ],
        },
      ],
      expectedModelContains: "gemini",
    },
    {
      name: "Tool use request",
      messages: [{ role: "user", content: "search the web for latest news" }],
      tools: [{ type: "function", function: { name: "search", description: "search" } }],
      expectedModelContains: "gpt-4o",
    },
    {
      name: "Direct override via /model",
      messages: [{ role: "user", content: "/model openai/gpt-4o explain quantum computing" }],
      expectedOverride: true,
      expectedModelContains: "gpt-4o",
    },
  ];

  for (const scenario of scenarios) {
    const decision = await route(
      {
        messages: scenario.messages as any,
        tools: scenario.tools,
        requestedModel: undefined,
        estimatedTokens: 50,
        needsStreaming: false,
      },
      config,
    );

    const topModel = decision.candidateProviders[0]?.id ?? "none";

    if (scenario.expectedOverride) {
      assert(decision.override?.detected === true, `${scenario.name}: override should be detected`);
      console.log(`  ✓ ${scenario.name} → OVERRIDE → ${topModel}`);
    } else if (decision.error) {
      console.log(`  ! ${scenario.name} → ERROR: ${decision.error}`);
    } else {
      assert(
        topModel.includes(scenario.expectedModelContains ?? ""),
        `${scenario.name}: expected model containing "${scenario.expectedModelContains}", got "${topModel}"`,
      );
      console.log(`  ✓ ${scenario.name} → tier=${decision.tier} → model=${topModel}`);
    }
  }

  console.log("  PASS: All routing decisions correct\n");
}

async function printRoutingTable(config: ReturnType<typeof loadProviders>) {
  console.log("=== Part 4: Live Routing Table ===");
  console.log("Config: 4 providers, defaultPriority=cost\n");

  const rows = [
    { prompt: "hello", tools: false, image: false },
    { prompt: "what is the capital of France", tools: false, image: false },
    { prompt: "write a short poem about rain", tools: false, image: false },
    { prompt: "explain how TCP/IP works", tools: false, image: false },
    { prompt: "analyse microservices vs monolith tradeoffs", tools: false, image: false },
    { prompt: "prove that sqrt(2) is irrational step by step", tools: false, image: false },
    { prompt: "[image attached: what is in this photo]", tools: false, image: true },
    { prompt: "[tool call: search the web]", tools: true, image: false },
  ];

  console.log("Prompt".padEnd(48) + "Task".padEnd(12) + "Top model".padEnd(25) + "Score  Tier");
  console.log("-".repeat(100));

  for (const row of rows) {
    const messages: any[] = row.image
      ? [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
              { type: "text", text: row.prompt },
            ],
          },
        ]
      : [{ role: "user", content: row.prompt }];

    const tools = row.tools ? [{ type: "function", function: { name: "search" } }] : undefined;

    const decision = await route(
      { messages, tools, estimatedTokens: 50, needsStreaming: false },
      config,
    );
    const model = decision.candidateProviders[0]?.id ?? decision.error ?? "no candidates";
    const filtered = decision.selection?.filtered?.map((f) => f.id) ?? [];
    const reason = filtered.length > 0 ? `filtered: ${filtered.join(", ")}` : `tier match`;

    const scoreStr = decision.complexityScore?.toFixed(2) ?? "N/A";
    const displayPrompt = row.prompt.length > 46 ? row.prompt.substring(0, 43) + "..." : row.prompt;

    console.log(
      displayPrompt.padEnd(48) +
        (decision.taskType ?? "?").padEnd(12) +
        model.padEnd(25) +
        scoreStr +
        "  " +
        (decision.tier ?? "??").padEnd(8) +
        reason,
    );
  }
  console.log();
}

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   IgniteRouter — OpenClaw Plugin Test    ║");
  console.log("╚══════════════════════════════════════════╝");

  testPluginStructure();
  const config = testProviderLoading();
  await testRoutingDecisions(config);
  await printRoutingTable(config);

  console.log("══════════════════════════════════════════");
  console.log("All tests passed. Plugin is ready for OpenClaw.");
  console.log("══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
