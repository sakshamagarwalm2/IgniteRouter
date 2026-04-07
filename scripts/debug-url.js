#!/usr/bin/env node
/**
 * Debug test - see what URL is being built
 */

import { buildUpstreamRequest, getProviderBaseUrl } from "../dist/index.js";
import { loadProviders } from "../dist/index.js";

const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
  ],
});

const provider = config.providers[0];
console.log("Provider:", provider.id);
console.log("Base URL:", getProviderBaseUrl(provider));

const request = buildUpstreamRequest(provider, {
  model: "mistral-large-latest",
  messages: [{ role: "user", content: "Hi" }],
  max_tokens: 10,
});

console.log("Built URL:", request.url);
console.log("Built Headers:", request.headers);
console.log("Built Body:", JSON.stringify(request.body).substring(0, 100));
