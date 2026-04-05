import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  scoreComplexity,
  scoreToTier,
  ComplexityTier,
  isRouteLLMAvailable,
} from "./complexity-scorer.js";

describe("scoreToTier", () => {
  it("scoreToTier(0.10) → SIMPLE", () => {
    expect(scoreToTier(0.1)).toBe(ComplexityTier.Simple);
  });

  it("scoreToTier(0.29) → SIMPLE", () => {
    expect(scoreToTier(0.29)).toBe(ComplexityTier.Simple);
  });

  it("scoreToTier(0.30) → MEDIUM", () => {
    expect(scoreToTier(0.3)).toBe(ComplexityTier.Medium);
  });

  it("scoreToTier(0.59) → MEDIUM", () => {
    expect(scoreToTier(0.59)).toBe(ComplexityTier.Medium);
  });

  it("scoreToTier(0.60) → COMPLEX", () => {
    expect(scoreToTier(0.6)).toBe(ComplexityTier.Complex);
  });

  it("scoreToTier(0.84) → COMPLEX", () => {
    expect(scoreToTier(0.84)).toBe(ComplexityTier.Complex);
  });

  it("scoreToTier(0.85) → EXPERT", () => {
    expect(scoreToTier(0.85)).toBe(ComplexityTier.Expert);
  });

  it("scoreToTier(0.99) → EXPERT", () => {
    expect(scoreToTier(0.99)).toBe(ComplexityTier.Expert);
  });
});

describe("scoreComplexity keyword fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockRejectedValue(new Error("RouteLLM not available"));
  });

  it('"hi" → SIMPLE', async () => {
    const result = await scoreComplexity("hi");
    expect(result.tier).toBe(ComplexityTier.Simple);
    expect(result.method).toBe("keyword-fallback");
    expect(result.score).toBeLessThan(0.3);
  });

  it('"what is photosynthesis" → not EXPERT', async () => {
    const result = await scoreComplexity("what is photosynthesis");
    expect(result.tier).not.toBe(ComplexityTier.Expert);
    expect(result.score).toBeLessThan(0.85);
  });

  it('"explain how TCP/IP works" → MEDIUM', async () => {
    const result = await scoreComplexity("explain how TCP/IP works");
    expect(result.tier).toBe(ComplexityTier.Medium);
  });

  it('"analyse the tradeoffs between SQL and NoSQL" → COMPLEX or EXPERT', async () => {
    const result = await scoreComplexity("analyse the tradeoffs between SQL and NoSQL");
    expect(result.tier === ComplexityTier.Complex || result.tier === ComplexityTier.Expert).toBe(
      true,
    );
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"prove that there are infinite primes" → EXPERT', async () => {
    const result = await scoreComplexity("prove that there are infinite primes");
    expect(result.tier).toBe(ComplexityTier.Expert);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it('"architect a distributed system at scale" → EXPERT', async () => {
    const result = await scoreComplexity("architect a distributed system at scale");
    expect(result.tier).toBe(ComplexityTier.Expert);
  });

  it("long prompt (2500+ chars) → higher score than short version", async () => {
    const shortPrompt = "explain TCP";
    const longPrompt =
      "explain TCP/IP works in detail with step by step analysis of each layer of the OSI model and how they interact with each other. Compare and contrast different approaches to network design and evaluate the tradeoffs between various implementation strategies. Comprehensive analysis needed.";

    const shortResult = await scoreComplexity(shortPrompt);
    const longResult = await scoreComplexity(longPrompt);

    expect(longResult.score).toBeGreaterThan(shortResult.score);
  });

  it("method is keyword-fallback when RouteLLM fails", async () => {
    const result = await scoreComplexity("hello world");
    expect(result.method).toBe("keyword-fallback");
  });

  it("does not throw when RouteLLM is unavailable", async () => {
    await expect(scoreComplexity("test prompt")).resolves.toBeDefined();
  });

  it("includes latencyMs in result", async () => {
    const result = await scoreComplexity("test");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("score is between 0.05 and 0.95", async () => {
    const result = await scoreComplexity(
      "prove a complex theorem about NP-complete problems with formal specification",
    );
    expect(result.score).toBeGreaterThanOrEqual(0.05);
    expect(result.score).toBeLessThanOrEqual(0.95);
  });
});

describe("scoreComplexity with RouteLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses routellm when server responds", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ score: 0.75 }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await scoreComplexity("test prompt");

    expect(result.method).toBe("routellm");
    expect(result.score).toBe(0.75);
    expect(result.tier).toBe(ComplexityTier.Complex);
  });

  it("falls back to keyword when RouteLLM returns non-ok", async () => {
    const mockResponse = {
      ok: false,
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await scoreComplexity("hi");

    expect(result.method).toBe("keyword-fallback");
    expect(result.tier).toBe(ComplexityTier.Simple);
  });

  it("falls back when RouteLLM times out", async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 100);
        }),
    );

    const result = await scoreComplexity("test");

    expect(result.method).toBe("keyword-fallback");
  });
});

describe("isRouteLLMAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when server is available", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const available = await isRouteLLMAvailable();

    expect(available).toBe(true);
  });

  it("returns false when server is not available", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    const available = await isRouteLLMAvailable();

    expect(available).toBe(false);
  });

  it("returns false when server returns non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    const available = await isRouteLLMAvailable();

    expect(available).toBe(false);
  });
});
