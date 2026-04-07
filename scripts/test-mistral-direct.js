#!/usr/bin/env node
/**
 * Direct test to Mistral to debug what's happening
 */

import https from "https";

const apiKey = "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v";
const model = "mistral-large-latest";
const baseUrl = "https://api.mistral.ai/v1";

// Direct call to Mistral
const postData = JSON.stringify({
  model,
  messages: [{ role: "user", content: "Hi" }],
  max_tokens: 10,
});

const options = {
  hostname: "api.mistral.ai",
  path: "/v1/chat/completions",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
};

console.log("Testing direct Mistral call...");
console.log("URL:", baseUrl + "/chat/completions");
console.log("Model:", model);

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", data.substring(0, 500));
  });
});

req.on("error", (e) => console.log("Error:", e.message));
req.write(postData);
req.end();
