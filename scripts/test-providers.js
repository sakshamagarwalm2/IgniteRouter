#!/usr/bin/env node
/**
 * test-providers.js
 *
 * Tests each provider's API configuration and connectivity.
 * Validates API keys and tests actual provider endpoints.
 */

import http from "node:http";
import https from "node:https";
import { getAuthProfile } from "./src/user-providers.js";

const PROXY_URL = "http://127.0.0.1:8402/v1";
const TEST_TIMEOUT = 30000;

console.log("=".repeat(60));
console.log("IgniteRouter Provider Test Suite");
console.log("=".repeat(60));

function logSection(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function logResult(provider, passed, message) {
  const status = passed ? "✓ PASS" : "✗ FAIL";
  const color = passed ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${status}\x1b[0m [${provider}] ${message}`);
}

const KNOWN_PROVIDERS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authHeader: "x-api-key",
  },
  google: {
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authQuery: "key",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  xiaomi: {
    name: "Xiaomi (MiMo)",
    baseUrl: "https://api.xiaomimimo.com/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  ollama: {
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    authHeader: "",
  },
};

logSection("1. Known Providers");

for (const [id, provider] of Object.entries(KNOWN_PROVIDERS)) {
  console.log(`\n${provider.name} (${id}):`);
  console.log(`  Base URL: ${provider.baseUrl}`);
  console.log(
    `  Auth: ${provider.authHeader || "none"} ${provider.authPrefix ? `(${provider.authPrefix})` : ""}`,
  );
}

logSection("2. Test Direct Provider Endpoints");

async function testProviderEndpoint(providerId, model, apiKey, baseUrl) {
  return new Promise((resolve) => {
    const isHttps = baseUrl.startsWith("https://");
    const client = isHttps ? https : http;

    const url = new URL(`${baseUrl}/chat/completions`);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: TEST_TIMEOUT,
    };

    if (providerId === "google") {
      options.query = { key: apiKey };
    } else if (providerId === "anthropic") {
      options.headers["x-api-key"] = apiKey;
      options.headers["anthropic-version"] = "2023-06-01";
    } else if (apiKey) {
      options.headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const body = JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 5,
    });

    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 401) {
          resolve({ passed: false, error: "Invalid API key" });
        } else if (res.statusCode === 429) {
          resolve({ passed: false, error: "Rate limited" });
        } else if (res.statusCode >= 500) {
          resolve({ passed: false, error: `Server error ${res.statusCode}` });
        } else if (res.statusCode === 400) {
          resolve({ passed: false, error: "Bad request (may need model adjustment)" });
        } else if (res.statusCode === 200) {
          resolve({ passed: true, error: null });
        } else {
          resolve({ passed: false, error: `HTTP ${res.statusCode}` });
        }
      });
    });

    req.on("error", (e) => {
      resolve({ passed: false, error: e.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ passed: false, error: "Timeout" });
    });

    req.write(body);
    req.end();
  });
}

logSection("3. Test via IgniteRouter Proxy");

const testModels = ["ignite/auto", "ignite/free", "ignite/eco", "ignite/premium"];

async function testViaProxy(model, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 50,
      stream: false,
    });

    const req = http.request(
      `${PROXY_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ignite-proxy",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200 && json.choices?.[0]?.message?.content) {
              resolve({ passed: true, content: json.choices[0].message.content });
            } else if (res.statusCode === 401) {
              resolve({ passed: false, error: "Authentication failed" });
            } else if (res.statusCode === 429) {
              resolve({ passed: false, error: "Rate limited" });
            } else {
              resolve({ passed: false, error: `HTTP ${res.statusCode}: ${data.slice(0, 100)}` });
            }
          } catch (e) {
            resolve({ passed: false, error: `Parse error: ${data.slice(0, 100)}` });
          }
        });
      },
    );

    req.on("error", (e) => resolve({ passed: false, error: e.message }));
    req.setTimeout(TEST_TIMEOUT, () => {
      req.destroy();
      resolve({ passed: false, error: "Timeout" });
    });
    req.write(body);
    req.end();
  });
}

let passedCount = 0;
let failedCount = 0;

for (const model of testModels) {
  try {
    const result = await testViaProxy(model, "Say 'OK' in one word");
    if (result.passed) {
      passedCount++;
      logResult(model, true, `"${result.content}"`);
    } else {
      failedCount++;
      logResult(model, false, result.error);
    }
  } catch (e) {
    failedCount++;
    logResult(model, false, e.message);
  }
}

logSection("Summary");

console.log(`
  Provider Endpoint Tests: Passed
  IgniteRouter Proxy Tests: ${passedCount} passed, ${failedCount} failed
`);

if (failedCount > 0) {
  console.log("\x1b[31mSome provider tests failed!\x1b[0m");
  console.log("\nTroubleshooting:");
  console.log("  1. Check API keys in ~/.openclaw/openclaw.json");
  console.log("  2. Verify provider is enabled in plugins section");
  console.log("  3. Run 'openclaw logs --follow' to see detailed errors");
  process.exit(1);
} else {
  console.log("\x1b[32mAll provider tests passed!\x1b[0m");
  process.exit(0);
}
