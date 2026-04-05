# IgniteRouter

**Smart LLM router for OpenClaw — bring your own models and API keys**

![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)
![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)

IgniteRouter is an OpenClaw plugin that sits between OpenClaw and your LLM providers. Instead of manually picking a model for every task, IgniteRouter reads each request, understands what kind of task it is and how complex it is, and automatically picks the best model from your configured list. If a model fails, it silently tries the next one.

You bring your own API keys for OpenAI, Anthropic, Google, DeepSeek, OpenRouter, or Ollama. There is no central server, no crypto wallet, no account required. Your API keys go directly from your machine to the LLM provider — IgniteRouter just decides which one to call.

## How It Works — The Complete Flow

1. **Request Received** — OpenClaw sends `POST /v1/chat/completions` with `model: "igniterouter/auto"` to `localhost:8402`.
2. **Override Check** — Did the user say `/model gpt-4o` or use `claude` in their message? If yes, skip routing and call that model directly.
3. **Task Classification** — (Local, <1ms, no API call) Classifies prompt as one of: Chat / Creative / Reasoning / Agentic / Vision / Deep.
4. **Complexity Scoring** — Keyword scorer gives a score 0.0–1.0, mapped to tier: Simple / Medium / Complex / Expert. *Optional: RouteLLM local server for more accurate scoring.*
5. **Candidate Selection** — Filters your provider list (removes models that can't handle vision/tools/context size), then ranks by your priority setting (cost / speed / quality) plus specialisation bonuses.
6. **Fallback Caller** — Tries candidates in order. On 429/500/503: try next. On 400: stop (prompt issue). On 401: skip this provider, try next.
7. **Provider URL Builder** — Constructs the correct request for each provider type (different URL, headers, body format for OpenAI vs Anthropic vs Google vs Ollama).
8. **Response Returned** — Response returned to OpenClaw with `X-IgniteRouter-Model/Tier/Task/Latency` headers.

### ASCII Flow Diagram

```text
OpenClaw / Any OpenAI-compatible tool
│
▼
POST /v1/chat/completions
model: "igniterouter/auto"
│
▼
┌─────────────────────────┐
│    Override Detector    │  ← /model gpt-4o, use claude, @openai/gpt-4o
└────────────┬────────────┘
│ no override
▼
┌─────────────────────────┐
│   Task Classifier       │  → Chat / Creative / Reasoning / Agentic / Vision / Deep
└────────────┬────────────┘
▼
┌─────────────────────────┐
│   Complexity Scorer     │  → Simple (0-0.3) / Medium / Complex / Expert (0.85-1.0)
└────────────┬────────────┘
▼
┌─────────────────────────┐
│   Candidate Selector    │  Filter → Rank by cost/speed/quality → Specialisation bonus
└────────────┬────────────┘
▼
┌─────────────────────────┐
│   Fallback Caller       │  Try #1 → fail? → Try #2 → fail? → Try #3 → all fail? → error
└────────────┬────────────┘
▼
┌─────────────────────────┐
│  Provider URL Builder   │  OpenAI / Anthropic / Google / DeepSeek / Ollama / OpenRouter
└────────────┬────────────┘
▼
Response to OpenClaw
X-IgniteRouter-Model: openai/gpt-4o
X-IgniteRouter-Tier: COMPLEX
X-IgniteRouter-Task: reasoning
```

## Task Types

| Task Type | When it triggers | Example prompt |
|-----------|-----------------|----------------|
| Vision | Image present in content (signal-based) | "What is in this image?" |
| Agentic | tools array present OR keywords like "search and", "execute", "automate" | "Search the web and summarise" |
| Deep | Prompt >8000 tokens OR keywords: "prove", "architect", "dissertation", "formally verify" | "Prove that sqrt(2) is irrational" |
| Reasoning | Keywords: "analyse", "compare", "tradeoffs", "step by step", "should I", "evaluate" | "Compare microservices vs monolith" |
| Creative | Keywords: "write a", "story", "poem", "brainstorm", "imagine", "invent" | "Write a short story about AI" |
| Chat | Default — nothing above matched | "Hello, how are you?" |

## Complexity Tiers

| Tier | Score Range | Maps to | Example |
|------|------------|---------|---------|
| SIMPLE | 0.00 – 0.30 | Cheapest model in this tier | "What is 2+2?" |
| MEDIUM | 0.30 – 0.60 | Mid-range model | "Explain how TCP/IP works" |
| COMPLEX | 0.60 – 0.85 | Capable model | "Build a React component" |
| EXPERT | 0.85 – 1.00 | Most capable model | "Prove this theorem step by step" |

## Supported Providers

| Provider prefix | Example model ID | Base URL used | Auth |
|----------------|-----------------|---------------|------|
| openai/ | openai/gpt-4o | https://api.openai.com/v1 | Authorization: Bearer |
| anthropic/ | anthropic/claude-opus-4 | https://api.anthropic.com/v1 | x-api-key header |
| google/ | google/gemini-2.5-flash | generativelanguage.googleapis.com | key= query param |
| deepseek/ | deepseek/deepseek-chat | https://api.deepseek.com/v1 | Authorization: Bearer |
| openrouter/ | openrouter/auto | https://openrouter.ai/api/v1 | Authorization: Bearer |
| ollama/ | ollama/llama3:8b | http://localhost:11434 (default) | None |
| custom | any/custom | Your baseUrl | Optional Bearer |

## Quick Start — Installing in OpenClaw

**Step 1 — Install Node 20+ and OpenClaw (if not already):**
```bash
npm install -g openclaw@latest
```

**Step 2 — Clone and build IgniteRouter:**
```bash
git clone https://github.com/sakshamagarwalm2/IgniteRouter.git
cd IgniteRouter
npm install
npm run build
```

**Step 3 — Install as a local plugin:**
```bash
openclaw plugins install . --local
```

**Step 4 — Open your OpenClaw config file.**
On Windows: `%APPDATA%\openclaw\openclaw.json`. On Mac/Linux: `~/.openclaw/openclaw.json`. Add IgniteRouter to the plugins section:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "igniterouter/auto"
      }
    }
  },
  "plugins": {
    "entries": {
      "igniterouter": {
        "enabled": true,
        "config": {
          "defaultPriority": "cost",
          "providers": [
            {
              "id": "openai/gpt-4o-mini",
              "apiKey": "sk-YOUR_KEY",
              "tier": "SIMPLE"
            },
            {
              "id": "openai/gpt-4o",
              "apiKey": "sk-YOUR_KEY",
              "tier": "COMPLEX"
            },
            {
              "id": "google/gemini-2.5-flash",
              "apiKey": "YOUR_GOOGLE_KEY",
              "tier": "SIMPLE",
              "specialisedFor": ["vision"],
              "priorityForTasks": { "vision": 1 }
            },
            {
              "id": "ollama/llama3:8b",
              "baseUrl": "http://localhost:11434",
              "tier": "MEDIUM"
            }
          ]
        }
      }
    }
  }
}
```

**Step 5 — Restart the gateway:**
```bash
openclaw gateway restart
```

**Step 6 — Verify it's working:**
```bash
# Check proxy is running
curl http://localhost:8402/health

# Check model list
curl http://localhost:8402/v1/models

# Check logs
openclaw logs --follow
```

Expected `/health` response:
```json
{
  "status": "ok",
  "plugin": "igniterouter",
  "version": "0.1.0",
  "providers": 4,
  "defaultPriority": "cost"
}
```

## Provider Configuration Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Model ID e.g. "openai/gpt-4o". Prefix determines provider type. |
| apiKey | string | For cloud models | Your API key for this provider |
| baseUrl | string | For Ollama/custom | Custom endpoint e.g. "http://localhost:11434" |
| tier | string | Yes | SIMPLE / MEDIUM / COMPLEX / EXPERT — which complexity level this model handles |
| specialisedFor | string[] | No | Task types this model excels at. Gets +25 priority bonus. Values: chat, creative, reasoning, agentic, vision, deep |
| avoidFor | string[] | No | Task types to deprioritise this model for. Gets -20 penalty. |
| priorityForTasks | object | No | Explicit rank override per task. { "vision": 1 } means always first for vision tasks |

## Routing Priority Modes

| Mode | What it does |
|------|-------------|
| cost | Cheapest model first. Free/local models always preferred. |
| speed | Fastest model first (lowest avgLatencyMs). |
| quality | Most capable model first (highest tier preferred). |

Change via config: `"defaultPriority": "speed"` — or at runtime with `/priority speed` in any message.

## Slash Commands

| Command | What it does |
|---------|-------------|
| /model auto | Reset to automatic routing |
| /model openai/gpt-4o | Use this specific model for this message |
| /model list | Show all configured providers and their tiers |
| /priority cost | Change routing priority to cost mode |
| /priority speed | Change routing priority to speed mode |
| /priority quality | Change routing priority to quality mode |
| /help | Show available commands |

## Pre-loaded Model Registry

These models are known to IgniteRouter — if you add them, metadata is auto-filled. You only need to provide `id`, `apiKey`, and `tier`:

| Model ID | Context | Vision | Tools | Input $/M | Output $/M |
|----------|---------|--------|-------|-----------|------------|
| openai/gpt-4o | 128k | ✓ | ✓ | $2.50 | $10.00 |
| openai/gpt-4o-mini | 128k | ✓ | ✓ | $0.15 | $0.60 |
| openai/o3 | 200k | — | ✓ | $2.00 | $8.00 |
| openai/o4-mini | 128k | — | ✓ | $1.10 | $4.40 |
| anthropic/claude-opus-4 | 200k | ✓ | ✓ | $15.00 | $75.00 |
| anthropic/claude-sonnet-4 | 200k | ✓ | ✓ | $3.00 | $15.00 |
| anthropic/claude-haiku-4 | 200k | ✓ | ✓ | $0.80 | $4.00 |
| google/gemini-2.5-pro | 1M | ✓ | ✓ | $1.25 | $10.00 |
| google/gemini-2.5-flash | 1M | ✓ | ✓ | $0.15 | $0.60 |
| google/gemini-2.5-flash-lite | 1M | ✓ | ✓ | $0.10 | $0.40 |
| deepseek/deepseek-chat | 128k | — | ✓ | $0.14 | $0.28 |
| deepseek/deepseek-reasoner | 128k | — | — | $0.55 | $2.19 |
| openrouter/auto | 200k | ✓ | ✓ | ~$3.00 | ~$15.00 |

*For Ollama models (prefix ollama/): price is always $0, isLocal=true, no API key needed.*

## Fallback Behavior

When a model fails, IgniteRouter tries the next candidate automatically:

| HTTP Status | What IgniteRouter does |
|-------------|----------------------|
| 429 Too Many Requests | Retry with next candidate |
| 500 / 502 / 503 / 504 | Retry with next candidate |
| 402 / quota exceeded | Retry with next candidate |
| 401 Unauthorized | Skip this provider, try next (bad API key) |
| 400 Bad Request | Stop entire chain — prompt issue, not provider issue |
| Timeout (30s) | Retry with next candidate |

When all candidates fail, the error message shows exactly what was tried:
```text
IgniteRouter tried 3 models:
openai/gpt-4o-mini    rate-limit (429)
google/gemini-2.5-flash    server-error (503)
ollama/llama3:8b    timeout (30s)
Please try again, or add more models to your provider list.
```

## Running Tests

```bash
# Unit tests (no API keys needed)
npm run test:unit

# Integration tests (no API keys needed, fetch is mocked)
npm run test:integration

# Installation simulation (tests plugin structure)
npm run test:install

# All tests
npm run test:all

# Watch mode
npm run test:watch
```

Expected output: `Test Files  6 passed`, `Tests  404 passed`

## Optional: RouteLLM for Smarter Complexity Scoring

By default, complexity is scored using a keyword fallback. For more accurate scoring, you can run RouteLLM locally:
```bash
pip install routellm
python -m routellm.server --port 8500 --router mf
```
IgniteRouter automatically detects and uses RouteLLM if it's running on `localhost:8500`. If it's not running, keyword scoring takes over with no error.

## Architecture: Source Files

| File | What it does |
|------|-------------|
| src/proxy.ts | Intercepts all requests, orchestrates the full routing flow |
| src/routing-engine.ts | Combines all routing pieces into one route() call |
| src/task-classifier.ts | Classifies prompts into 6 task types |
| src/complexity-scorer.ts | Scores complexity 0–1, maps to tier |
| src/override-detector.ts | Detects /model commands and explicit model requests |
| src/priority-selector.ts | Filters providers by capability, ranks by priority |
| src/fallback-caller.ts | Calls models in order, handles failures |
| src/provider-url-builder.ts | Builds correct upstream request per provider type |
| src/user-providers.ts | Loads and validates provider config from openclaw.json |
| src/provider.ts | Registers igniterouter/auto with OpenClaw |

## Project Stats
- 404 tests across 22 test files
- 0 TypeScript errors
- 10 source modules
- 13 pre-loaded known models
- 6 task types
- 4 complexity tiers
- 7 provider types supported

## License

# PolyForm Noncommercial 1.0.0

<https://polyformproject.org/licenses/noncommercial/1.0.0>

## Acceptance

By using the Work, You accept and agree to be bound by the terms and conditions of this License.

## Grant of Rights

Copyright (C) 2026 IgniteRouter Contributors

Subject to the terms and conditions of this License, You are hereby granted a
non-exclusive, perpetual, worldwide, royalty-free copyright license to reproduce, prepare
derivative works of, publicly display, publicly perform, and distribute the Work (and any
derivative works in any form), solely for Noncommercial Purposes.

## Restrictions

**Noncommercial Purposes** means any purpose that is primarily intended for or directed toward
commercial advantage or monetary compensation. Examples of Noncommercial Purposes include, but are
not limited to:

- Using the Work to provide commercial consulting services
- Using the Work in a commercial product or service that generates revenue
- Using the Work to offer a paid API or service

The following activities are **NOT** Noncommercial Purposes:

- Research, including commercial research
- Personal use
- Educational use
- Use by nonprofit organizations

You may NOT use the Work for any Commercial Purpose unless:

1. You have obtained a separate commercial license from the copyright holders; or
2. The Work is used under a different license that explicitly permits commercial use.

## Additional Terms

When distributing or publicly displaying the Work or any derivative work, You must:

1. Include a copy of this license with all copies or distributions
2. Clearly mark any material that is a derivative work
3. Include the copyright notice: "Copyright (C) 2026 IgniteRouter Contributors"

## Disclaimer

THE WORK IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE WORK OR THE USE OR OTHER
DEALINGS IN THE WORK.

**Third-party components:**
- ClawRouter by BlockRunAI — MIT License — https://github.com/BlockRunAI/ClawRouter
- RouteLLM by LMSYS — Apache 2.0 — https://github.com/lm-sys/RouteLLM


