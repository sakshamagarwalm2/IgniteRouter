# IgniteRouter

<div align="center">

**Smart LLM router for OpenClaw — bring your own models and API keys**

Routes each request to the right model based on task type and complexity.
Automatic fallback if a model fails.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-20+-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

</div>

---

## What is IgniteRouter?

IgniteRouter is a smart LLM routing plugin for [OpenClaw](https://openclaw.ai) that routes requests to the right model based on task complexity and type. It features:

- **Task-aware routing** — classifies requests as Chat, Creative, Reasoning, Agentic, Vision, or Deep
- **Complexity scoring** — uses RouteLLM or keyword fallback to determine if a request is Simple, Medium, Complex, or Expert
- **User-defined providers** — bring your own API keys and models
- **Automatic fallback** — if a model fails (rate limit, timeout, etc.), IgniteRouter automatically tries the next candidate
- **Priority modes** — rank by cost, speed, or quality
- **Override detection** — users can explicitly name models via `/model`, `@model`, or API field

---

## Acknowledgments

IgniteRouter stands on the shoulders of giants:

### ClawRouter

IgniteRouter was originally forked from [ClawRouter](https://github.com/BlockRunAI/ClawRouter) by BlockRunAI. ClawRouter pioneered the concept of lightweight, local LLM routing with tiered model selection. The core routing strategies and many utilities have been adapted and extended.

### RouteLLM

Complex prompts benefit from [RouteLLM](https://github.com/lm-sys/FastChat) by LMSYS. When RouteLLM is available locally, IgniteRouter uses it for accurate complexity scoring. The keyword fallback ensures routing always works, even without RouteLLM.

---

## Quick Start

### Installation

```bash
# Via npm
npm install @igniterouter/igniterouter

# Or via OpenClaw
openclaw plugins install @igniterouter/igniterouter
```

### Configuration

Add your models to `openclaw.yaml`:

```yaml
plugins:
  - id: igniterouter
    config:
      defaultPriority: cost # cost | speed | quality
      providers:
        - id: openai/gpt-4o
          apiKey: sk-your-key
          tier: COMPLEX
          specialisedFor: [reasoning]
        - id: openai/gpt-4o-mini
          apiKey: sk-your-key
          tier: SIMPLE
        - id: google/gemini-2.5-flash
          apiKey: your-google-key
          tier: SIMPLE
          specialisedFor: [vision]
          priorityForTasks:
            vision: 1
        - id: ollama/llama3:70b
          baseUrl: http://localhost:11434
          tier: COMPLEX
```

### Usage

That's it! OpenClaw will automatically route requests:

```
You: Explain photosynthesis
  → Routed to: gpt-4o-mini (SIMPLE task, cost priority)

You: Analyze the tradeoffs between microservices and monolith
  → Routed to: gpt-4o (REASONING task, COMPLEX tier)

You: Prove that sqrt(2) is irrational
  → Routed to: gpt-4o (EXPERT task, deep reasoning)

You: /model claude-opus explain this
  → Override: using claude-opus as requested
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     IgniteRouter                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Request    │───▶│    Task      │───▶│  Complexity  │  │
│  │   (proxy)   │    │ Classifier   │    │    Scorer    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                                        │          │
│         │           ┌──────────────┐              │          │
│         └─────────▶│   Override    │              │          │
│                   │  Detector    │              │          │
│                   └──────────────┘              │          │
│                         │                        │          │
│                         ▼                        ▼          │
│                   ┌──────────────────────────────────┐     │
│                   │      Priority Selector           │     │
│                   │  (filter, rank, tier match)     │     │
│                   └──────────────────────────────────┘     │
│                                    │                        │
│                                    ▼                        │
│                   ┌──────────────────────────────────┐     │
│                   │        Fallback Caller          │     │
│                   │   (try candidates in order)     │     │
│                   └──────────────────────────────────┘     │
│                                    │                        │
│                                    ▼                        │
│                   ┌──────────────────────────────────┐     │
│                   │         Response Stream           │     │
│                   └──────────────────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component             | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Task Classifier**   | Classifies requests into 6 types: Chat, Creative, Reasoning, Agentic, Vision, Deep |
| **Complexity Scorer** | Scores 0.0-1.0 via RouteLLM or keyword fallback                                    |
| **Override Detector** | Detects explicit model requests via `/model`, `@model`, or API field               |
| **Priority Selector** | Filters by capability, ranks by tier/priority/specialization                       |
| **Fallback Caller**   | Tries candidates in order, handles errors gracefully                               |

---

## Configuration Reference

### Provider Schema

```yaml
providers:
  - id: string # Required. Model ID (e.g. "openai/gpt-4o")
    apiKey: string # Required (except local models)
    baseUrl: string # For Ollama or custom endpoints
    tier: string # Required. SIMPLE | MEDIUM | COMPLEX | EXPERT
    specialisedFor: # Task types this model handles best
      - reasoning
      - vision
    priorityForTasks: # Explicit rank overrides
      vision: 1 # Rank 1 = highest priority
```

### Tier Mapping

| Tier    | Score Range | Use Case                               |
| ------- | ----------- | -------------------------------------- |
| SIMPLE  | 0.00 - 0.30 | Chat, greetings, simple questions      |
| MEDIUM  | 0.30 - 0.60 | Explanations, summaries, descriptions  |
| COMPLEX | 0.60 - 0.85 | Analysis, comparisons, implementations |
| EXPERT  | 0.85 - 1.00 | Proofs, dissertations, system design   |

---

## RouteLLM Integration

For accurate complexity scoring, run RouteLLM locally:

```bash
# Install RouteLLM
pip install routellm

# Start server
routellm server --port 8500
```

When RouteLLM is unavailable, IgniteRouter falls back to keyword-based scoring automatically.

---

## CLI Commands

```bash
# View routing statistics
openclaw stats

# View stats for last 7 days
openclaw stats 7

# Clear statistics
openclaw stats clear

# Manage model exclusions
/exclude           # Show excluded models
/exclude add <model>    # Block a model
/exclude remove <model> # Unblock a model
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm run test

# Run unit tests only (IgniteRouter modules)
npm run test:unit

# Build
npm run build

# Typecheck
npm run typecheck

# Install locally
./scripts/install.sh

# Uninstall
./scripts/uninstall.sh
```

---

## License

IgniteRouter is licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 IgniteRouter Contributors

---

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

---

<div align="center">

**Built with ❤️ for the OpenClaw community**

</div>
