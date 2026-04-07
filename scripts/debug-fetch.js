#!/usr/bin/env node
/**
 * Debug - show what's actually passed to fetch
 */

import { loadProviders } from "../dist/index.js";

// Replicate how the proxy calls buildUpstreamRequest
const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
  ],
});

const provider = config.providers[0];
console.log("Provider loaded:", provider.id);
console.log("  apiKey:", provider.apiKey ? "present" : "missing");
console.log("  baseUrl:", provider.baseUrl || "(auto)");

// Replicate the provider-url-builder.ts logic manually
const id = provider.id.toLowerCase();
let baseUrl = "";
if (provider.baseUrl) {
  baseUrl = provider.baseUrl.replace(/\/+$/, "");
} else if (id.startsWith("mistral-large-latest")) {
  baseUrl = "https://api.mistral.ai/v1";
}

console.log("Computed baseUrl:", baseUrl);

const url = `${baseUrl}/chat/completions`;
console.log("Final URL:", url);

const authHeaders = {};
authHeaders["Authorization"] = `Bearer ${provider.apiKey}`;
console.log("Auth headers:", authHeaders);

const body = {
  model: "mistral-large-latest",
  messages: [{ role: "user", content: "Hi" }],
  max_tokens: 10,
};
console.log("Body:", JSON.stringify(body));

// Now try the actual fetch
console.log("\nTrying fetch...");
try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  console.log("Status:", response.status);
  const text = await response.text();
  console.log("Response:", text.substring(0, 200));
} catch (e) {
  console.log("Error:", e.message);
}
