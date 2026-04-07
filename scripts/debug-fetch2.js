#!/usr/bin/env node
/**
 * Debug test with fetch logging
 */

// Add debugging to fetch
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  console.error("=== FETCH CALLED ===");
  console.error("URL:", typeof url === "string" ? url : url.toString());
  console.error(
    "Init:",
    JSON.stringify({
      method: init?.method,
      headers: init?.headers,
      body: init?.body?.toString()?.substring(0, 100),
    }),
  );

  try {
    const result = await originalFetch(url, init);
    console.error("Response status:", result.status);
    return result;
  } catch (e) {
    console.error("Fetch error:", e.message);
    throw e;
  }
};

import { startProxy } from "./dist/index.js";
import { loadProviders } from "./dist/index.js";

const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
  ],
});

console.error("Starting proxy...");

const proxy = await startProxy({
  port: 8402,
  igniteConfig: config,
  onReady: (port) => console.error("Proxy started on", port),
});

console.error("Proxy ready. Waiting for requests...");

// Now make a request to trigger the fetch
setTimeout(async () => {
  const response = await fetch("http://localhost:8402/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer ignite-proxy",
    },
    body: JSON.stringify({
      model: "ignite/auto",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 10,
    }),
  });
  console.error("Got response:", response.status);
  const text = await response.text();
  console.error("Response:", text.substring(0, 200));
}, 2000);

setTimeout(() => process.exit(0), 10000);
