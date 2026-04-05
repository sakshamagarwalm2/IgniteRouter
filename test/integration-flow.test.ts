import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { startProxy } from "../src/index.js";
import { loadProviders } from "../src/user-providers.js";
import http from "node:http";

// Mock global fetch for upstream calls
global.fetch = vi.fn();

vi.mock("../src/updater.js", () => ({
  checkForUpdates: vi.fn(),
}));

function makeRequest(options: http.RequestOptions, body?: any): Promise<{ status: number, headers: http.IncomingHttpHeaders, data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            data: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({ status: res.statusCode || 0, headers: res.headers, data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function createMockResponse(body: any, status = 200) {
  const jsonStr = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(jsonStr),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(jsonStr));
        controller.close();
      }
    })
  };
}

describe("IgniteRouter Integration Flow", () => {
  const PORT = 18405; // Use unique port to avoid reuse
  let serverHandle: any;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterAll(async () => {
    if (serverHandle) {
      await serverHandle.close();
    }
  });

  it("IT01: Proxy starts on port 18405", async () => {
    const igniteConfig = loadProviders({
      defaultPriority: "cost",
      providers: [
        { id: "openai/gpt-4o-mini", apiKey: "test-key", tier: "SIMPLE" },
      ],
    });

    serverHandle = await startProxy({ port: PORT, igniteConfig, cacheConfig: { enabled: false } });
    expect(serverHandle.server).toBeDefined();
    expect(serverHandle.port).toBe(PORT);
  });

  it("IT02: GET /health returns structured JSON", async () => {
    const res = await makeRequest({ port: PORT, path: "/health", method: "GET" });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("ok");
    expect(res.data.plugin).toBe("igniterouter");
  });

  it("IT03: GET /v1/models returns list including 'igniterouter/auto'", async () => {
    const res = await makeRequest({ port: PORT, path: "/v1/models", method: "GET" });
    expect(res.data.data.some((m: any) => m.id === "igniterouter/auto")).toBe(true);
  });

  it("IT04: GET /v1/models returns list including all configured provider IDs", async () => {
    const res = await makeRequest({ port: PORT, path: "/v1/models", method: "GET" });
    expect(res.data.data.some((m: any) => m.id === "openai/gpt-4o-mini")).toBe(true);
  });

  it("IT05: POST /v1/chat/completions with model='igniterouter/auto', simple prompt -> routes to provider", async () => {
    (global.fetch as any).mockResolvedValue(createMockResponse({
      id: "chatcmpl-test",
      choices: [{ message: { role: "assistant", content: "test response" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 }
    }));

    const res = await makeRequest({ 
      port: PORT, 
      path: "/v1/chat/completions", 
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test" }
    }, {
      model: "igniterouter/auto",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-igniterouter-model"]).toBe("openai/gpt-4o-mini");
    expect(res.headers["x-igniterouter-tier"]).toBeDefined();
  });

  it("IT07: POST /v1/chat/completions with explicit model -> skips routing", async () => {
    (global.fetch as any).mockResolvedValue(createMockResponse({
      id: "chatcmpl-test",
      choices: [{ message: { role: "assistant", content: "explicit response" } }]
    }));

    const res = await makeRequest({ 
      port: PORT, 
      path: "/v1/chat/completions", 
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test" }
    }, {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-igniterouter-model"]).toBe("openai/gpt-4o-mini");
  });

  it("IT08: POST /v1/chat/completions with unknown model -> returns 400", async () => {
    const res = await makeRequest({ 
      port: PORT, 
      path: "/v1/chat/completions", 
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test" }
    }, {
      model: "unknown/model",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(res.status).toBe(400);
    expect(res.data.error.message).toContain("not configured");
  });

  it("IT11: First provider returns 429 -> automatically retries with second provider", async () => {
    await serverHandle.close();
    await new Promise(r => setTimeout(r, 1000)); // Give it a second
    
    const igniteConfig = loadProviders({
      defaultPriority: "cost",
      providers: [
        { id: "openai/gpt-4o-mini", apiKey: "test-key", tier: "SIMPLE" },
        { id: "anthropic/claude-haiku-4", apiKey: "test-key", tier: "SIMPLE" },
      ],
    });

    serverHandle = await startProxy({ port: PORT, igniteConfig, cacheConfig: { enabled: false } });

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes("api.openai.com")) {
        return createMockResponse({ error: "rate limit" }, 429);
      }
      if (url.includes("api.anthropic.com")) {
        return createMockResponse({
          id: "chatcmpl-test-2",
          choices: [{ message: { role: "assistant", content: "fallback response" } }]
        });
      }
      return createMockResponse({ score: 0.5 }); // complexity scorer
    });

    const res = await makeRequest({ 
      port: PORT, 
      path: "/v1/chat/completions", 
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test" }
    }, {
      model: "igniterouter/auto",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-igniterouter-model"]).toBe("anthropic/claude-haiku-4");
  });

  it("IT14: /model list in message -> returns provider list", async () => {
    const res = await makeRequest({ 
      port: PORT, 
      path: "/v1/chat/completions", 
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test" }
    }, {
      model: "igniterouter/auto",
      messages: [{ role: "user", content: "/model list" }]
    });

    expect(res.data.choices[0].message.content).toContain("Configured providers:");
    expect(res.data.choices[0].message.content).toContain("openai/gpt-4o-mini");
  });
});
