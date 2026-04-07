#!/usr/bin/env node
/**
 * Debug what's being sent to Mistral
 */

import https from "https";

const apiKey = "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v";
const model = "mistral-large-latest";
const messages = [{ role: "user", content: "What is 2+2?" }];
const max_tokens = 20;

const body = JSON.stringify({
  model,
  messages,
  max_tokens,
});

console.log("Request body:", body);
console.log("Body length:", body.length);

const options = {
  hostname: "api.mistral.ai",
  port: 443,
  path: "/v1/chat/completions",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Length": body.length,
  },
};

const req = https.request(options, (res) => {
  console.log("Status:", res.statusCode);
  let data = "";
  res.on("data", (c) => (data += c));
  res.on("end", () => console.log("Response:", data.substring(0, 200)));
});

req.on("error", (e) => console.log("Error:", e.message));
req.write(body);
req.end();
