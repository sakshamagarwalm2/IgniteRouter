#!/usr/bin/env node
/**
 * Test fetch in the proxy's context - ESM style
 */

import https from "https";

// Override fetch BEFORE importing the module
globalThis.fetch = async (url, init) => {
  console.error("=== Custom fetch called ===");
  const urlStr = typeof url === "string" ? url : url.toString();
  console.error("URL:", urlStr);
  console.error("Method:", init?.method);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: init?.method || "GET",
      headers: init?.headers || {},
    };

    console.error("HTTPS options:", options);

    const req = https.request(options, (res) => {
      console.error("Got response:", res.statusCode);
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        resolve(new Response(data, { status: res.statusCode, headers: new Headers(res.headers) }));
      });
    });
    req.on("error", (e) => {
      console.error("Request error:", e.message);
      reject(e);
    });
    if (init?.body) req.write(init.body);
    req.end();
  });
};

import { startProxy } from "../dist/index.js";
import { loadProviders } from "../dist/index.js";

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
  onReady: (port) => console.error("Proxy on", port),
});

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
  console.error("Response status:", response.status);
  const text = await response.text();
  console.error("Response body:", text.substring(0, 200));
  process.exit(0);
}, 2000);
