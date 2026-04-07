#!/usr/bin/env node
/**
 * Test the proxy with network debugging
 */

import http from "http";

const PROXY_URL = "http://127.0.0.1:8402/v1";

// Test via the running proxy with debugging
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
    console.log("Status from proxy:", res.statusCode);
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      console.log("Response from proxy:", data);
    });
  },
);

req.on("error", (e) => console.log("Error:", e.message));

req.write(
  JSON.stringify({
    model: "mistral-large-latest",
    messages: [{ role: "user", content: "Hi" }],
    max_tokens: 10,
  }),
);

req.end();
