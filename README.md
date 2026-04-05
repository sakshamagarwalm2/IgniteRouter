# IgniteRouter

<div align="center">

**Smart LLM router for OpenClaw — bring your own models and API keys**

Routes each request to the right model based on task type and complexity.
Automatic fallback if a model fails. Zero crypto. Zero hardcoded models.

[![License](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-orange.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-20+-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-404%20passing-brightgreen.svg?style=flat-square)](#testing)
[![Build](https://img.shields.io/badge/Build-passing-brightgreen.svg?style=flat-square)](#development)

</div>

---

## What is IgniteRouter?

IgniteRouter is a plugin for [OpenClaw](https://openclaw.ai) and [AtomicBot](https://atomicbot.ai) that sits between your AI assistant and your LLM providers. Every message goes through it. It reads the prompt, figures out what kind of task it is and how hard it is, picks the best model from **your own list**, calls it with **your own API key**, and if it fails tries the next one automatically — without you seeing anything.

**Before IgniteRouter:** Every message goes to one model. Simple "hello" costs the same as a complex analysis.

**After IgniteRouter:** Simple questions go to cheap fast models. Complex tasks go to capable models. You spend 60–85% less. You configure it once and forget about it.

---

## Key Features

| Feature              | Description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Task-aware routing   | Classifies prompts as Chat / Creative / Reasoning / Agentic / Vision / Deep                    |
| Complexity scoring   | Scores 0.0–1.0 using RouteLLM or keyword fallback → maps to Simple / Medium / Complex / Expert |
| Your own models      | Bring any provider: OpenAI, Anthropic, Google, DeepSeek, Ollama, OpenRouter                    |
| Your own API keys    | Each model uses your key directly — no middleman, no markup                                    |
| Automatic fallback   | Rate limit / timeout / server error → silently tries next model                                |
| Priority modes       | Rank models by cost, speed, or quality                                                         |
| Model override       | User can say `/model gpt-4o` or `use claude-opus` to bypass routing                            |
| Backwards compatible | If no providers configured, falls back to original ClawRouter behaviour                        |

---

## How It Works

When a message arrives, IgniteRouter runs 6 steps in under 50ms:

```
User message
      │
      ▼
1. Override check ──── user said "/model X" or "use gpt-4o"? ──── YES ──▶ call that model directly
      │ NO
      ▼
2. Task classifier ─── what kind of task is this?
      │                Chat / Creative / Reasoning / Agentic / Vision / Deep
      ▼
3. Complexity scorer ─ how hard is this? (RouteLLM or keyword fallback)
      │                Simple (0–0.30) / Medium (0.30–0.60) / Complex (0.60–0.85) / Expert (0.85–1.0)
      ▼
4. Capability filter ─ remove models that cannot handle this request
      │                too small context / no vision / no tool calling
      ▼
5. Priority selector ─ rank remaining models
      │                by cost / speed / quality + task specialisation bonus
      ▼
6. Fallback caller ─── try model #1 → fail → try #2 → fail → try #3 → ...
                       success: stream to user
                       all fail: show clear error message
```

### What gets routed where

| Prompt example                      | Task type | Tier    | What happens                |
| ----------------------------------- | --------- | ------- | --------------------------- |
| "hello how are you"                 | Chat      | Simple  | cheapest model in your list |
| "write a poem about rain"           | Creative  | Simple  | cheapest available          |
| "explain how TCP works"             | Reasoning | Medium  | medium-tier model           |
| "analyse microservices vs monolith" | Reasoning | Complex | complex-tier model          |
| "prove that sqrt(2) is irrational"  | Deep      | Expert  | most capable model          |
| [image attached]                    | Vision    | any     | only vision-capable models  |
| [tools array present]               | Agentic   | any     | only tool-calling models    |
| "/model gpt-4o do this"             | override  | —       | gpt-4o directly, no routing |

---

## Project Stats

| Metric                         | Value      |
| ------------------------------ | ---------- |
| Total test files               | 22         |
| Total tests passing            | 404        |
| Build status                   | passing    |
| Typecheck errors               | 0          |
| New source files added         | 10         |
| Files removed (crypto/payment) | 15+        |
| Languages                      | TypeScript |
| Node requirement               | 20+        |

### Test coverage by module

| Module                     | File                            | Tests |
| -------------------------- | ------------------------------- | ----- |
| Task classifier            | `src/task-classifier.test.ts`   | 25    |
| Complexity scorer          | `src/complexity-scorer.test.ts` | 25    |
| User providers + override  | `src/user-providers.test.ts`    | 21    |
| Routing engine             | `src/routing-engine.test.ts`    | 12    |
| E2E with dummy providers   | `test/e2e-ignite.test.ts`       | 21    |
| Response cache             | `src/response-cache*.test.ts`   | 164   |
| Proxy                      | `src/proxy.*.test.ts`           | 29    |
| Router (original)          | `src/router/*.test.ts`          | 19    |
| Session / journal / models | various                         | 88    |

---

## Setup Guide

### Prerequisites

| Requirement | Details                                                       |
| ----------- | ------------------------------------------------------------- |
| Node.js     | 20 or higher                                                  |
| OpenClaw    | `npm install -g openclaw@latest`                              |
| LLM API key | OpenAI, Anthropic, Google, etc. **OR** Ollama running locally |

---

### Step 1 — Install

**Option A: From npm (once published)**

```bash
openclaw plugins install @igniterouter/igniterouter
```

**Option B: From source**

```bash
git clone https://github.com/sakshamagarwalm2/IgniteRouter.git
cd IgniteRouter
npm install
npm run build
./scripts/install.sh
```

---

### Step 2 — Configure your models

Open `~/.openclaw/openclaw.yaml` and add:

```yaml
plugins:
  - id: igniterouter
    config:
      defaultPriority: cost # cost | speed | quality
      providers:
        # Simple tier — cheap fast models
        - id: openai/gpt-4o-mini
          apiKey: sk-your-openai-key
          tier: SIMPLE

        - id: google/gemini-2.5-flash
          apiKey: your-google-key
          tier: SIMPLE
          specialisedFor: [vision]
          priorityForTasks:
            vision: 1

        # Medium tier
        - id: deepseek/deepseek-chat
          apiKey: your-deepseek-key
          tier: MEDIUM

        # Complex tier
        - id: openai/gpt-4o
          apiKey: sk-your-openai-key
          tier: COMPLEX
          specialisedFor: [reasoning]

        # Expert tier
        - id: anthropic/claude-opus-4
          apiKey: sk-ant-your-key
          tier: EXPERT

        # Local model — free, private
        - id: ollama/llama3:70b
          baseUrl: http://localhost:11434
          tier: COMPLEX
```

---

### Step 3 — Restart

```bash
openclaw gateway restart
```

---

## Configuration Reference

### Provider schema

```yaml
providers:
  - id: string # Required. e.g. "openai/gpt-4o"
    apiKey: string # Required for cloud models
    baseUrl: string # Optional. For Ollama: http://localhost:11434
    tier: SIMPLE|MEDIUM|COMPLEX|EXPERT # Required
    specialisedFor: # Optional. Priority bonus for these task types
      - chat
      - creative
      - reasoning
      - agentic
      - vision
      - deep
    avoidFor: # Optional. Penalty for these task types
      - creative
    priorityForTasks: # Optional. Explicit rank override (1 = highest)
      vision: 1
      reasoning: 2
```

---

### Complexity tiers

| Tier    | Score range | What it means      | Example prompts                               |
| ------- | ----------- | ------------------ | --------------------------------------------- |
| SIMPLE  | 0.00 – 0.30 | Trivial, one-shot  | "hello", "what is X", "translate this"        |
| MEDIUM  | 0.30 – 0.60 | Moderate effort    | "explain TCP", "summarise this article"       |
| COMPLEX | 0.60 – 0.85 | Significant work   | "analyse tradeoffs", "write this function"    |
| EXPERT  | 0.85 – 1.00 | Maximum capability | "prove this theorem", "architect this system" |

---

### Task types

| Type      | Detected by                                                   | Best model traits              |
| --------- | ------------------------------------------------------------- | ------------------------------ |
| Chat      | "hello", "what is", "define", "translate"                     | Fast, cheap                    |
| Creative  | "write a story", "poem", "brainstorm", "imagine"              | Creative capability            |
| Reasoning | "analyse", "compare", "should I", "tradeoffs", "step by step" | Strong reasoning               |
| Agentic   | `tools` array present in request                              | Tool calling support           |
| Vision    | Image in `content` array                                      | Vision capability              |
| Deep      | Prompt > 8000 tokens, or "prove", "architect", "dissertation" | Large context, high capability |

---

### Priority modes

| Mode      | Behaviour                                                                      |
| --------- | ------------------------------------------------------------------------------ |
| `cost`    | Cheapest model in the matching tier first. Free/local models always preferred. |
| `speed`   | Lowest latency model first.                                                    |
| `quality` | Highest-tier model first regardless of cost.                                   |

---

### Model override — how users pick a specific model

Users can bypass routing:

```
/model gpt-4o explain this to me
use claude-opus for this task
@openai/gpt-4o help me with this
```

Short aliases:

```
/model claude-opus
/model gemini-flash
/model deepseek
```

---

## Pre-filled model registry

IgniteRouter knows the capabilities of these models. You only need to provide `id`, `apiKey`, and `tier`:

| Model ID                       | Context | Vision | Tools | Input $/M | Output $/M | Latency |
| ------------------------------ | ------- | ------ | ----- | --------- | ---------- | ------- |
| `openai/gpt-4o`                | 128K    | yes    | yes   | $2.50     | $10.00     | 800ms   |
| `openai/gpt-4o-mini`           | 128K    | yes    | yes   | $0.15     | $0.60      | 400ms   |
| `openai/o3`                    | 200K    | no     | yes   | $2.00     | $8.00      | 2000ms  |
| `openai/o4-mini`               | 128K    | no     | yes   | $1.10     | $4.40      | 1200ms  |
| `anthropic/claude-opus-4`      | 200K    | yes    | yes   | $15.00    | $75.00     | 1500ms  |
| `anthropic/claude-sonnet-4`    | 200K    | yes    | yes   | $3.00     | $15.00     | 900ms   |
| `anthropic/claude-haiku-4`     | 200K    | yes    | yes   | $0.80     | $4.00      | 400ms   |
| `google/gemini-2.5-pro`        | 1M      | yes    | yes   | $1.25     | $10.00     | 1200ms  |
| `google/gemini-2.5-flash`      | 1M      | yes    | yes   | $0.15     | $0.60      | 400ms   |
| `google/gemini-2.5-flash-lite` | 1M      | yes    | yes   | $0.10     | $0.40      | 300ms   |
| `deepseek/deepseek-chat`       | 128K    | no     | yes   | $0.14     | $0.28      | 600ms   |
| `deepseek/deepseek-reasoner`   | 128K    | no     | no    | $0.55     | $2.19      | 2000ms  |
| `openrouter/auto`              | 200K    | yes    | yes   | $3.00     | $15.00     | 1000ms  |

**Ollama models** (`ollama/*`): context=64K, vision=no, tools=no, price=$0, latency=500ms, local=true.

---

## Fallback behaviour

When a model fails, IgniteRouter tries the next candidate automatically.

| HTTP code | Reason             | Action              |
| --------- | ------------------ | ------------------- |
| 429       | Rate limit         | Retry next model    |
| 500 / 503 | Server error       | Retry next model    |
| 402       | Quota exceeded     | Retry next model    |
| timeout   | No response in 30s | Retry next model    |
| 400       | Bad request        | Stop — prompt issue |
| 401       | Wrong API key      | Skip, try next      |

If all candidates fail, the user sees:

```
IgniteRouter tried 3 models:
  openai/gpt-4o         rate-limit (429)
  anthropic/claude-opus server-error (503)
  ollama/llama3:70b     timeout (30s)
Please try again, or add more models to your provider list.
```

---

## Architecture

| File                       | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `src/task-classifier.ts`   | Detects task type from prompt keywords and signals                       |
| `src/complexity-scorer.ts` | Scores complexity 0.0–1.0, calls RouteLLM or keyword fallback            |
| `src/override-detector.ts` | Detects explicit model requests from user                                |
| `src/user-providers.ts`    | Loads user config, merges with KNOWN_MODELS registry                     |
| `src/priority-selector.ts` | Filters by capability, ranks by priority mode + task bonus               |
| `src/fallback-caller.ts`   | Tries models in order, classifies errors, builds error summary           |
| `src/routing-engine.ts`    | Orchestrates all steps, returns routing decision                         |
| `src/proxy.ts`             | HTTP proxy — intercepts requests, calls routing engine, streams response |
| `src/provider.ts`          | Registers plugin with OpenClaw                                           |
| `src/models.ts`            | Model definitions and aliases                                            |
| `src/logger.ts`            | Usage logging to `~/.openclaw/igniterouter/logs/`                        |
| `src/dedup.ts`             | Request deduplication — prevents double-calls on retries                 |

---

## Testing

### Run all tests

```bash
npx vitest run
```

**Result:** 22 test files, 404 tests passing

### Run unit tests only (IgniteRouter modules)

```bash
npm run test:unit
```

**Result:** 4 test files, 83 tests

| File                            | Tests |
| ------------------------------- | ----- |
| `src/task-classifier.test.ts`   | 25    |
| `src/complexity-scorer.test.ts` | 25    |
| `src/user-providers.test.ts`    | 21    |
| `src/routing-engine.test.ts`    | 12    |

### Run E2E routing tests

```bash
npx vitest run test/e2e-ignite.test.ts
```

### Print routing table

Shows which model gets picked for different prompts:

```bash
npx tsx test/e2e-ignite.test.ts
```

**Output:**

```
Prompt                                   Task         Tier       Top Model                    Score
---------------------------------------------------------------------------------------------------------
hello                                   chat        SIMPLE    cheap-chat/model-a          0.20
write me a poem                         creative    SIMPLE    cheap-chat/model-a          0.25
explain how TCP works                   chat        MEDIUM    mid-range/model-b           0.55
analyse microservices vs monolith       reasoning   MEDIUM    mid-range/model-b           0.45
prove sqrt(2) is irrational             deep        COMPLEX   local/ollama-model-d        0.60
[image request]                         vision      SIMPLE    vision-capable/model-c      0.25
[tool use request]                      chat        SIMPLE    mid-range/model-b           0.25
```

---

## Development

```bash
# Clone and install
git clone https://github.com/sakshamagarwalm2/IgniteRouter.git
cd IgniteRouter
npm install

# Build
npm run build

# Typecheck
npm run typecheck

# Run all tests
npx vitest run

# Run unit tests only
npm run test:unit

# Run E2E routing tests
npx vitest run test/e2e-ignite.test.ts

# Watch mode
npm run test:watch

# Install locally
./scripts/install.sh

# Uninstall
./scripts/uninstall.sh
```

---

## Acknowledgments

| Project                                                | License    | What we use                                                                  |
| ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| [ClawRouter](https://github.com/BlockRunAI/ClawRouter) | MIT        | Proxy infrastructure, OpenClaw plugin, SSE streaming, deduplication, logging |
| [RouteLLM](https://github.com/lm-sys/RouteLLM)         | Apache 2.0 | ML-based complexity scoring (optional local server)                          |
| [OpenClaw](https://openclaw.ai)                        | —          | Platform this plugin runs on                                                 |

---

## License

**IgniteRouter:** PolyForm Noncommercial 1.0.0

| Use case                   | Permitted?                        |
| -------------------------- | --------------------------------- |
| Personal use               | ✅ Yes                            |
| Research                   | ✅ Yes                            |
| Educational use            | ✅ Yes                            |
| Nonprofit use              | ✅ Yes                            |
| Commercial consulting      | ❌ No (requires separate license) |
| Commercial product/service | ❌ No (requires separate license) |
| Paid API or service        | ❌ No (requires separate license) |

For commercial licensing: igniterouter@example.com

---

## Contributing

| Requirement | Details                        |
| ----------- | ------------------------------ |
| New modules | Must include unit tests        |
| Build       | `npm run build` must pass      |
| Typecheck   | `npm run typecheck` must pass  |
| Style       | Follow existing file structure |

---

<div align="center">

**Built for the OpenClaw community**

[GitHub](https://github.com/sakshamagarwalm2/IgniteRouter) · [OpenClaw](https://openclaw.ai) · [Report an issue](https://github.com/sakshamagarwalm2/IgniteRouter/issues)

</div>
