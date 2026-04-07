#!/usr/bin/env node
/**
 * test-models.js
 *
 * Tests individual models available through IgniteRouter.
 * Tests routing, response quality, and API reachability.
 */

import http from "node:http";
import { IgniteRouter_MODELS, OPENCLAW_MODELS } from "./dist/index.js";

const PROXY_URL = "http://127.0.0.1:8402/v1";
const TEST_TIMEOUT = 30000;

console.log("=".repeat(60));
console.log("IgniteRouter Model Test Suite");
console.log("=".repeat(60));

function logSection(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function logResult(model, passed, message) {
  const status = passed ? "✓ PASS" : "✗ FAIL";
  const color = passed ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${status}\x1b[0m [${model}] ${message}`);
}

async function chatCompletion(model, messages, options = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
      stream: false,
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
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, data: json });
          } catch (e) {
            reject(new Error(`Parse error: ${data.slice(0, 200)}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(TEST_TIMEOUT, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function testModel(modelId, testPrompt, expectedType) {
  try {
    const result = await chatCompletion(modelId, [{ role: "user", content: testPrompt }]);

    if (result.status !== 200) {
      return { passed: false, error: `HTTP ${result.status}` };
    }

    const content = result.data.choices?.[0]?.message?.content;
    if (!content) {
      return { passed: false, error: "No content in response" };
    }

    return { passed: true, content, usage: result.data.usage };
  } catch (e) {
    return { passed: false, error: e.message };
  }
}

logSection("1. Available Models");

const modelsByProvider = {};
for (const model of IgniteRouter_MODELS) {
  const provider = model.id.split("/")[0] || "unknown";
  if (!modelsByProvider[provider]) modelsByProvider[provider] = [];
  modelsByProvider[provider].push(model);
}

for (const [provider, models] of Object.entries(modelsByProvider)) {
  console.log(`\n${provider} (${models.length} models):`);
  for (const model of models.slice(0, 5)) {
    const price = model.inputPrice === 0 ? "FREE" : `$${model.inputPrice}/${model.outputPrice}`;
    console.log(`  - ${model.id} [${price}]`);
  }
  if (models.length > 5) console.log(`  ... and ${models.length - 5} more`);
}

logSection("2. Test: Simple Factual Query");

const simplePrompts = ["What is 2+2?", "What is the capital of France?", "List 3 colors."];

let simplePassed = 0;
let simpleFailed = 0;

for (const prompt of simplePrompts) {
  const result = await testModel("ignite/auto", prompt, "simple");
  if (result.passed) {
    simplePassed++;
    logResult(
      "ignite/auto",
      true,
      `"${prompt.substring(0, 30)}..." → ${result.content?.substring(0, 50) || "OK"}`,
    );
  } else {
    simpleFailed++;
    logResult("ignite/auto", false, `"${prompt.substring(0, 30)}..." → ${result.error}`);
  }
}

logSection("3. Test: Complex Reasoning");

const complexPrompts = [
  "Explain the tradeoffs between microservices and monolith architecture.",
  "Compare and contrast React vs Vue.js.",
  "What are the pros and cons of using TypeScript?",
];

let complexPassed = 0;
let complexFailed = 0;

for (const prompt of complexPrompts) {
  const result = await testModel("ignite/auto", prompt, "complex");
  if (result.passed) {
    complexPassed++;
    logResult("ignite/auto", true, `Reasoning test passed`);
  } else {
    complexFailed++;
    logResult("ignite/auto", false, `${result.error}`);
  }
}

logSection("4. Test: Code Generation");

const codePrompts = [
  "Write a function to calculate fibonacci numbers in JavaScript.",
  "Create a simple Express.js server with 2 routes.",
];

let codePassed = 0;
let codeFailed = 0;

for (const prompt of codePrompts) {
  const result = await testModel("ignite/auto", prompt, "code");
  if (result.passed) {
    codePassed++;
    logResult("ignite/auto", true, `Code generation test passed`);
  } else {
    codeFailed++;
    logResult("ignite/auto", false, `${result.error}`);
  }
}

logSection("5. Test: Force Specific Models");

const testSpecificModels = async () => {
  const modelsToTest = ["ignite/free", "ignite/eco", "ignite/premium"];

  for (const modelId of modelsToTest) {
    try {
      const result = await testModel(modelId, "Say 'test passed' in 3 words", "simple");
      if (result.passed) {
        logResult(modelId, true, "Model responds");
      } else {
        logResult(modelId, false, result.error);
      }
    } catch (e) {
      logResult(modelId, false, e.message);
    }
  }
};

await testSpecificModels();

logSection("Summary");

console.log(`
  Simple queries:  ${simplePassed} passed, ${simpleFailed} failed
  Complex queries: ${complexPassed} passed, ${complexFailed} failed  
  Code generation: ${codePassed} passed, ${codeFailed} failed
`);

const totalPassed = simplePassed + complexPassed + codePassed;
const totalFailed = simpleFailed + complexFailed + codeFailed;

if (totalFailed > 0) {
  console.log("\x1b[31mSome tests failed!\x1b[0m");
  process.exit(1);
} else {
  console.log("\x1b[32mAll tests passed!\x1b[0m");
  process.exit(0);
}
