#!/usr/bin/env node
/**
 * Simple test to see if node fetch works in this context
 */

console.log("Testing fetch in Node...");

try {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer wQ989AzrDfURKtFub7BE6jFiCdkMqN8v",
    },
    body: JSON.stringify({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    }),
  });
  console.log("Status:", response.status);
  const text = await response.text();
  console.log("Response:", text.substring(0, 100));
} catch (e) {
  console.log("Error:", e.message);
}
