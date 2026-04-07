import { createServer } from "node:http";

process.env.IGNITEROUTER_LOG_LEVEL = "debug";

import { startProxy } from "../dist/index.js";
import { loadProviders } from "../dist/index.js";

const mockUpstream = createServer((req, res) => {
  console.log(`[Mock] ${req.method} ${req.url}`);
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    console.log(`[Mock] Model: ${parsed.model}, Body length: ${body.length}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: parsed.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: `Response from ${parsed.model}` },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
  });
});

mockUpstream.listen(9100, "127.0.0.1");

const openClawPluginConfig = {
  defaultPriority: "cost",
  providers: [
    {
      id: "deepseek/deepseek-chat",
      baseUrl: "http://127.0.0.1:9100",
      apiKey: "mock",
      tier: "SIMPLE",
    },
    {
      id: "deepseek/deepseek-reasoner",
      baseUrl: "http://127.0.0.1:9100",
      apiKey: "mock",
      tier: "MEDIUM",
    },
    {
      id: "mistral/mistral-large-latest",
      baseUrl: "http://127.0.0.1:9100",
      apiKey: "mock",
      tier: "COMPLEX",
    },
    {
      id: "xiaomi/mimo-v2-flash",
      baseUrl: "http://127.0.0.1:9100",
      apiKey: "mock",
      tier: "SIMPLE",
    },
    { id: "openrouter/auto", baseUrl: "http://127.0.0.1:9100", apiKey: "mock", tier: "EXPERT" },
  ],
};

const igniteConfig = loadProviders(openClawPluginConfig);

async function runTest() {
  const proxy = await startProxy({
    port: 8406,
    igniteConfig,
    onReady: (port) => console.log(`Proxy ready on port ${port}`),
    onRouted: (d) => console.log(`[Routed] ${d.model} | ${d.taskType} | ${d.tier}`),
  });

  const prompts = [
    "Hi",
    "Compare the architectural differences between monolithic and microservices",
    "Write a complex Python script with asyncio and PostgreSQL",
  ];

  for (const prompt of prompts) {
    console.log(`\n>>> Prompt: ${prompt.substring(0, 40)}...`);
    const res = await fetch("http://127.0.0.1:8406/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "igniterouter/auto",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
      }),
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log(`Response: ${JSON.stringify(data).substring(0, 200)}`);
  }

  await proxy.close();
  mockUpstream.close();
  process.exit(0);
}

runTest().catch(console.error);
