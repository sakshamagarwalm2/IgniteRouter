#!/usr/bin/env node
/**
 * Debug what's actually passed to fetch in the proxy context
 */

// First let's monkey-patch fetch globally to log everything
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  // Only log external API calls
  const urlStr = typeof url === "string" ? url : url.toString();
  if (urlStr.includes("api.mistral") || urlStr.includes("api.deepseek")) {
    console.error("=== FETCH TO PROVIDER ===");
    console.error("URL:", urlStr);
    console.error("Method:", init?.method);
    console.error("Headers:", JSON.stringify(init?.headers).substring(0, 200));
    console.error("Body:", init?.body?.toString()?.substring(0, 100));
  }

  try {
    return await originalFetch(url, init);
  } catch (e) {
    console.error("FETCH ERROR:", e.message);
    throw e;
  }
};

import { startProxy } from "../dist/index.js";
import { loadProviders } from "../dist/index.js";

const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
  ],
});

console.log("Starting proxy...");

const proxy = await startProxy({
  port: 8402,
  igniteConfig: config,
  onReady: (port) => console.log("Proxy started on", port),
});

console.log("Ready. Waiting for request...");
setTimeout(() => {}, 60000);
