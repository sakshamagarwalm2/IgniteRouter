#!/usr/bin/env node
/**
 * Real LLM Test - Fixed model IDs
 */

import http from "node:http";

const PROXY_URL = "http://127.0.0.1:8402/v1";

function chat(model, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: 100,
      temperature: 0.7,
    });

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
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.setTimeout(90000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("═".repeat(80));
  console.log("REAL LLM TEST - FIXED CONFIG");
  console.log("═".repeat(80));

  // Test 1: Simple prompt with auto routing
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: Simple Prompt - ignite/auto                                       │");
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  try {
    const result = await chat("ignite/auto", [{ role: "user", content: "What is 2+2?" }]);

    console.log("Status:", result.status);

    if (result.status === 200) {
      const json = JSON.parse(result.data);
      console.log("Response:", json.choices[0].message.content);
      console.log("Model used:", result.headers["x-igniterouter-model"]);
      console.log("Tier:", result.headers["x-igniterouter-tier"]);
    } else {
      console.log("Error:", result.data);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test 2: DeepSeek direct
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: DeepSeek Chat - direct                                             │");
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  try {
    const result = await chat("deepseek-chat", [
      { role: "user", content: "Say 'Hello from DeepSeek' in 4 words" },
    ]);

    console.log("Status:", result.status);
    if (result.status === 200) {
      const json = JSON.parse(result.data);
      console.log("Response:", json.choices[0].message.content);
      console.log("Model used:", result.headers["x-igniterouter-model"]);
    } else {
      console.log("Error:", result.data);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test 3: Complex reasoning
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Test 3: Reasoning - ignite/auto                                             │");
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  try {
    const result = await chat("ignite/auto", [
      { role: "user", content: "Explain TCP/IP in 2 sentences" },
    ]);

    console.log("Status:", result.status);
    if (result.status === 200) {
      const json = JSON.parse(result.data);
      console.log("Response:", json.choices[0].message.content);
      console.log("Model used:", result.headers["x-igniterouter-model"]);
      console.log("Tier:", result.headers["x-igniterouter-tier"]);
    } else {
      console.log("Error:", result.data);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test 4: Mistral
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Test 4: Mistral Large - direct                                             │");
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  try {
    const result = await chat("mistral-large-latest", [
      { role: "user", content: "Say 'Hello from Mistral' in 4 words" },
    ]);

    console.log("Status:", result.status);
    if (result.status === 200) {
      const json = JSON.parse(result.data);
      console.log("Response:", json.choices[0].message.content);
    } else {
      console.log("Error:", result.data);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test 5: Code generation
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Test 5: Code Generation - ignite/auto                                      │");
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");

  try {
    const result = await chat("ignite/auto", [
      { role: "user", content: "Write a function to add two numbers in JavaScript" },
    ]);

    console.log("Status:", result.status);
    if (result.status === 200) {
      const json = JSON.parse(result.data);
      console.log("Response:", json.choices[0].message.content.substring(0, 200));
      console.log("Model:", result.headers["x-igniterouter-model"]);
    } else {
      console.log("Error:", result.data);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  console.log("\n" + "═".repeat(80));
  console.log("TESTS COMPLETE");
  console.log("═".repeat(80));
}

main().catch(console.error);
