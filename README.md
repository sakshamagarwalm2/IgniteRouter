# IgniteRouter

**Smart LLM router for OpenClaw — Decision-Only Mode**

A keyword-based routing system that intelligently selects the best LLM for each task based on complexity, task type, and provider capabilities.

![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)
![Test Pass Rate](https://img.shields.io/badge/Test%20Pass%20Rate-92%25-green)

## Overview

IgniteRouter operates in **decision-only mode** — it analyzes incoming requests and recommends the best LLM, but doesn't call LLMs directly. OpenClaw uses the recommendation to call the LLM directly.

### Supported Providers

| Provider    | Type  | Models                                                                                                          |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| **Ollama**  | Local | llama3.2:1b, llama3.2:3b, llama3.1:8b, llama3.1:70b, codellama:34b, deepseek-r1:7b, deepseek-r1:14b, qwen2.5:3b |
| **MiniMax** | Cloud | minimax-text-01, minimax-reasoner                                                                               |

## How It Works

```
┌──────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│    User      │────▶│     OpenClaw         │────▶│   LLM Direct    │
│   Request    │     │  (calls /v1/decide)   │     │  (recommended)  │
└──────────────┘     └─────────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌─────────────────────┐
                     │    IgniteRouter      │
                     │  - Override Detection│
                     │  - Task Classification│
                     │  - Complexity Scoring │
                     │  - Model Selection   │
                     └─────────────────────┘
```

### Routing Flow

1. **Override Detection** — Check if user explicitly requested a model
2. **Task Classification** — Detect task type (vision, agentic, reasoning, etc.)
3. **Complexity Scoring** — Score 0-1 based on keywords
4. **Model Selection** — Pick best model from tier config
5. **Return Decision** — OpenClaw calls LLM directly

## Endpoints

| Endpoint     | Method | Description              |
| ------------ | ------ | ------------------------ |
| `/health`    | GET    | Health check             |
| `/v1/decide` | POST   | Get model recommendation |
| `/v1/models` | GET    | List available models    |

### Decision Endpoint

**Request:**

```json
{
  "messages": [
    {"role": "user", "content": "Explain TCP/IP"}
  ],
  "tools": [{"type": "function", ...}],
  "model": "igniterouter/auto"
}
```

**Response:**

```json
{
  "recommendedModel": "ollama/llama3.1:8b",
  "tier": "MEDIUM",
  "taskType": "general",
  "complexityScore": 0.45,
  "reasoning": "Medium complexity task, tool-capable model selected",
  "alternatives": [{ "model": "ollama/llama3.2:3b", "tier": "SIMPLE", "providerName": "ollama" }],
  "capabilities": {
    "supportsVision": false,
    "supportsTools": true,
    "supportsStreaming": true,
    "contextWindow": 128000
  },
  "routingLatencyMs": 3
}
```

## Tier Configuration

IgniteRouter uses **tier-based routing** with ClawRouter-style configurations.

### AUTO Profile (Default)

| Tier          | Primary Model    | Fallbacks                                   |
| ------------- | ---------------- | ------------------------------------------- |
| **SIMPLE**    | llama3.2:3b      | minimax-text-01, qwen2.5:3b                 |
| **MEDIUM**    | llama3.1:8b      | minimax-text-01, llama3.2:3b                |
| **COMPLEX**   | llama3.1:70b     | minimax-text-01, llama3.1:8b, codellama:34b |
| **REASONING** | minimax-reasoner | deepseek-r1:14b, llama3.1:70b               |

### ECO Profile (Cost-optimized)

| Tier          | Primary Model  | Fallbacks                                  |
| ------------- | -------------- | ------------------------------------------ |
| **SIMPLE**    | llama3.2:1b    | qwen2.5:1.5b, llama3.2:3b                  |
| **MEDIUM**    | llama3.2:3b    | llama3.2:1b, qwen2.5:3b                    |
| **COMPLEX**   | llama3.1:8b    | llama3.2:3b, codellama:7b, minimax-text-01 |
| **REASONING** | deepseek-r1:7b | llama3.1:8b, minimax-reasoner              |

### PREMIUM Profile

| Tier          | Primary Model    | Fallbacks                        |
| ------------- | ---------------- | -------------------------------- |
| **SIMPLE**    | minimax-text-01  | llama3.1:8b, llama3.2:3b         |
| **MEDIUM**    | minimax-text-01  | llama3.1:70b, llama3.1:8b        |
| **COMPLEX**   | minimax-text-01  | llama3.1:70b, codellama:34b      |
| **REASONING** | minimax-reasoner | deepseek-r1:14b, deepseek-r1:32b |

### AGENTIC Profile (Tools-optimized)

| Tier          | Primary Model   | Fallbacks                         |
| ------------- | --------------- | --------------------------------- |
| **SIMPLE**    | llama3.2:3b     | minimax-text-01, llama3.2:1b      |
| **MEDIUM**    | llama3.1:8b     | minimax-text-01, llama3.2:3b      |
| **COMPLEX**   | llama3.1:70b    | minimax-text-01, codellama:34b    |
| **REASONING** | deepseek-r1:14b | minimax-reasoner, deepseek-r1:32b |

## Complexity Scoring

IgniteRouter uses **keyword-based complexity scoring** (0.0 - 1.0).

### Tier Boundaries

| Score Range | Tier      | Example Tasks                               |
| ----------- | --------- | ------------------------------------------- |
| 0.0 - 0.3   | SIMPLE    | Greetings, definitions, translations        |
| 0.3 - 0.5   | MEDIUM    | Explanations, comparisons, tutorials        |
| 0.5 - 0.65  | COMPLEX   | Code implementation, debugging, refactoring |
| 0.65 - 1.0  | REASONING | Mathematical proofs, system architecture    |

### Keyword Categories

**Expert Signals (+0.35 per match, max 4)**

- Mathematical: `prove`, `derive`, `theorem`, `induction`
- Architecture: `architect`, `design system`, `distributed`
- Analysis: `time complexity`, `optimize performance`, `NP-complete`

**Complex Signals (+0.25 per match, max 2)**

- Implementation: `implement`, `debug`, `refactor`, `evaluate`
- Technical: `postgresql`, `asyncio`, `REST API`, `React hooks`
- Data structures: `binary tree`, `heap`, `graph algorithm`

**Medium Signals (+0.15 per match, max 3)**

- Explanation: `explain`, `describe`, `compare`
- Development: `build`, `create`, `design`, `authentication`
- Technical: `microservices`, `kubernetes`, `async/await`

## Task Classification

| Task Type     | Detection Method                        | Example                |
| ------------- | --------------------------------------- | ---------------------- |
| **Vision**    | Image content detected                  | "Describe this image"  |
| **Agentic**   | Tools array present or keywords         | "Search and summarize" |
| **Reasoning** | Keywords: `prove`, `analyse`, `compare` | "Compare SQL vs NoSQL" |
| **Creative**  | Keywords: `write`, `story`, `poem`      | "Write a short story"  |
| **Deep**      | Long context (>8000 tokens)             | Large code review      |
| **Chat**      | Default fallback                        | "Hello, how are you?"  |

## Override Detection

Users can explicitly request a specific model:

- **API field**: Set `model: "ollama/qwen2.5:3b"`
- **Prompt patterns**: `use qwen for this`, `use minimax-reasoner`
- **Slash commands**: `/model llama3.1:70b`

## Promotions System

MiniMax models are promoted for specific tasks:

| Original Tier | Promoted To      | Condition                        |
| ------------- | ---------------- | -------------------------------- |
| MEDIUM        | minimax-reasoner | Task contains reasoning keywords |
| SIMPLE        | minimax-text-01  | Vision required, hasImages: true |

## Quick Start

```bash
# Clone and build
git clone https://github.com/sakshamagarwalm2/IgniteRouter.git
cd IgniteRouter
npm install
npm run build

# Copy to OpenClaw extensions
cp -r dist/* ~/.openclaw/extensions/igniterouter/

# Start OpenClaw gateway
openclaw gateway

# Test decision endpoint
curl -X POST http://localhost:8403/v1/decide \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```

## Running Tests

```bash
# Run comprehensive test suite (129 tests)
npx tsx comprehensive-test.ts

# Run detailed decision test (29 prompts)
npx tsx detailed-test.ts
```

### Test Results

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                           IGNITEROUTER - DETAILED ROUTING DECISIONS                  │
├────┬────────────────────────────────────┬─────────┬────────┬─────────────────────┤
│ #  │ Prompt                             │ Task    │ Score  │ Model Selected       │
├────┼────────────────────────────────────┼─────────┼────────┼─────────────────────┤
│  1 │ hi                                │ chat    │  0.10  │ llama3.2:3b          │
│  5 │ how does async/await work in JS   │ deep    │  0.45  │ llama3.1:8b          │
│ 11 │ implement a binary search tree    │ chat    │  0.55  │ llama3.1:70b         │
│ 15 │ create a REST API with auth       │ chat    │  0.60  │ llama3.1:70b         │
│ 19 │ architect a distributed system    │ deep    │  0.95  │ minimax-reasoner     │
│ 20 │ prove that there are infinitely... │ deep    │  0.85  │ minimax-reasoner     │
│ 24 │ use qwen for this                 │ chat    │  0.15  │ qwen2.5:3b (override)│
└────┴────────────────────────────────────┴─────────┴────────┴─────────────────────┘

📊 Summary: 26 passed, 2 failed (92.9% accuracy)
```

## Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── decide-endpoint.ts          # /v1/decide handler
├── routing-engine-v2.ts        # Core routing logic
├── complexity-scorer.ts        # Keyword-based scoring
├── task-classifier.ts          # Task type detection
├── override-detector.ts        # Model override detection
├── priority-selector.ts         # Provider selection
├── router/
│   └── routing-config.ts      # Tier configurations
└── openclaw-providers.ts      # Load from OpenClaw config

tests/
├── comprehensive-test.ts       # 129 comprehensive tests
└── detailed-test.ts           # 29 detailed decision tests
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenClaw                              │
│  1. Receives user message                                   │
│  2. Calls POST /v1/decide                                  │
│  3. Gets recommended model                                  │
│  4. Calls LLM directly (NO PROXY)                           │
│  5. Handles tools directly                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    IgniteRouter                             │
│                                                             │
│  override-detector.ts                                      │
│    └─ Check for explicit model requests                     │
│                                                             │
│  task-classifier.ts                                        │
│    └─ Detect: vision, agentic, reasoning, creative, deep  │
│                                                             │
│  complexity-scorer.ts                                       │
│    └─ Score 0-1 based on keywords                          │
│    └─ Boundaries: SIMPLE<0.3, MEDIUM<0.5, COMPLEX<0.65    │
│                                                             │
│  routing-engine-v2.ts                                       │
│    └─ Select tier from config (auto/eco/premium/agentic)   │
│    └─ Apply promotions (MiniMax)                            │
│    └─ Build fallback chain                                  │
│    └─ Return decision                                       │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

- **Keyword-Based Scoring**: No LLM calls needed for routing decisions
- **Tier-Based Selection**: Simple, Medium, Complex, Reasoning tiers
- **Multiple Profiles**: auto, eco, premium, agentic
- **Fallback Chains**: Automatic failover to backup models
- **Capability Filtering**: Vision, tools, context window support
- **Override Detection**: Users can explicitly request models
- **Local + Cloud**: Supports both Ollama (local) and MiniMax (cloud)

## License

PolyForm Noncommercial 1.0.0
