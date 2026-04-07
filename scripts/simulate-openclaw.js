import { createServer, request } from "node:http";

process.env.IGNITEROUTER_LOG_LEVEL = "debug";

import { startProxy } from "../dist/index.js";
import { loadProviders } from "../dist/index.js";

// --- Mock Upstream Server ---
const mockUpstream = createServer((req, res) => {
  console.log(`[Mock Upstream] ${req.method} ${req.url}`);
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      console.log(`[Mock Upstream] Body: ${body.substring(0, 100)}...`);
      const parsed = JSON.parse(body);
      console.log(`[Mock Upstream] Model: ${parsed.model}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock-completion",
          object: "chat.completion",
          created: Date.now(),
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: `This is a mock response for ${parsed.model}.`,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      );
    } catch (e) {
      console.error(`[Mock Upstream] Error: ${e.message}`);
      res.writeHead(400);
      res.end("Invalid JSON");
    }
  });
});

mockUpstream.listen(9000, "127.0.0.1");

// --- Proxy Configuration ---
const openClawPluginConfig = {
  defaultPriority: "cost",
  providers: [
    {
      id: "deepseek/deepseek-chat",
      baseUrl: "http://127.0.0.1:9000",
      apiKey: "mock",
      tier: "SIMPLE",
    },
    {
      id: "deepseek/deepseek-reasoner",
      baseUrl: "http://127.0.0.1:9000",
      apiKey: "mock",
      tier: "MEDIUM",
    },
    {
      id: "mistral/mistral-large-latest",
      baseUrl: "http://127.0.0.1:9000",
      apiKey: "mock",
      tier: "COMPLEX",
    },
    {
      id: "xiaomi/mimo-v2-flash",
      baseUrl: "http://127.0.0.1:9000",
      apiKey: "mock",
      tier: "SIMPLE",
    },
    { id: "openrouter/auto", baseUrl: "http://127.0.0.1:9000", apiKey: "mock", tier: "EXPERT" },
  ],
};

const igniteConfig = loadProviders(openClawPluginConfig);

async function runTest() {
  console.log("Starting IgniteRouter Proxy...");

  const proxy = await startProxy({
    port: 8405,
    igniteConfig,
    onReady: (port) => console.log(`Proxy ready on port ${port}`),
    onRouted: (d) => {
      console.log(`\n--- [Routed] Model: ${d.model} | Task: ${d.taskType} | Tier: ${d.tier} ---`);
    },
  });

  console.log("--- Manual fetch test: proxy to mock ---");
  try {
    const res = await fetch("http://127.0.0.1:9000/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test", messages: [] }),
    });
    console.log("Direct fetch status:", res.status);
  } catch (e) {
    console.error("Direct fetch failed:", e.message);
  }

  console.log("--- Manual fetch test: health ---");
  try {
    const res = await fetch("http://127.0.0.1:8405/health");
    console.log("Health check status:", res.status);
    console.log("Health check body:", await res.json());
  } catch (e) {
    console.error("Health check failed:", e.message);
  }

  const testPrompts = [
    {
      name: "Simple",
      prompt: "Hi there! Just give me a quick 1-sentence summary of what a router does.",
    },
    {
      name: "Complex",
      prompt:
        "Compare the architectural differences between a monolithic and microservices approach for a high-traffic e-commerce site. Provide a pros/cons table.",
    },
    {
      name: "Expert",
      prompt:
        "Write a complex Python script that uses asyncio to scrape 5 different websites, handles rate limiting, and stores the results in a PostgreSQL database using SQLAlchemy. Include error handling for network timeouts.",
    },
  ];

  for (const t of testPrompts) {
    console.log(`\n>>> Sending: ${t.prompt}`);

    await new Promise((resolve) => {
      const reqBody = JSON.stringify({
        model: "igniterouter/auto",
        messages: [{ role: "user", content: t.prompt }],
        tools: t.tools,
        stream: false,
      });

      console.log(`[Sim] Requesting http://127.0.0.1:8405/v1/chat/completions`);
      const req = request(
        {
          hostname: "127.0.0.1",
          port: 8405,
          path: "/v1/chat/completions",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(reqBody),
          },
        },
        (res) => {
          console.log(`[Sim] Status: ${res.statusCode}`);
          let resBody = "";
          res.on("data", (chunk) => (resBody += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              console.log(`<<< Success!`);
            } else {
              console.error(`<<< Failed: ${res.statusCode} ${resBody}`);
            }
            resolve();
          });
        },
      );

      req.on("error", (e) => {
        console.error(`<<< Connection error: ${e.message}`);
        resolve();
      });

      req.write(reqBody);
      req.end();
    });
  }

  await proxy.close();
  mockUpstream.close();
  process.exit(0);
}

runTest().catch(console.error);
