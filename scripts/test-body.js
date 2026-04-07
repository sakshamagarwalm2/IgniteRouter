#!/usr/bin/env node
/**
 * Test body parsing
 */

import { loadProviders, buildUpstreamRequest } from "../dist/index.js";

const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
  ],
});

const provider = config.providers[0];

// Simulate what proxy does
const bodyStr =
  '{"model":"mistral-large-latest","messages":[{"role":"user","content":"Hi"}],"max_tokens":10}';
const bodyObj = JSON.parse(bodyStr);

console.log("Parsed body:", JSON.stringify(bodyObj));

const result = buildUpstreamRequest(provider, bodyObj);
console.log("Built request:");
console.log("  URL:", result.url);
console.log("  Headers:", result.headers);
console.log("  Body:", JSON.stringify(result.body));
