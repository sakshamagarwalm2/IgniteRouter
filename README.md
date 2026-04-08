# IgniteRouter

**Smart LLM router for OpenClaw — Decision-Only Mode**

![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)

## Decision-Only Mode

IgniteRouter now operates in **decision-only mode**. Instead of calling LLMs directly, it provides intelligent model recommendations that OpenClaw uses to call the LLM directly.

### How It Works

```
1. User sends message to OpenClaw
   │
   ▼
2. OpenClaw calls: POST http://localhost:8403/v1/decide
   {
     messages: [{"role": "user", "content": "Explain TCP/IP"}],
     tools: [...]
   }
   │
   ▼
3. IgniteRouter returns decision:
   {
     recommendedModel: "deepseek/deepseek-chat",
     tier: "MEDIUM",
     taskType: "general",
     reasoning: "Medium complexity task",
     alternatives: [...]
   }
   │
   ▼
4. OpenClaw calls LLM directly using recommendedModel
   POST https://api.deepseek.com/v1/chat/completions
   {
     model: "deepseek-chat",
     messages: [...]
   }
   │
   ▼
5. LLM returns response to OpenClaw
```

### Benefits

- **No Proxy**: Eliminates the middleman hop
- **Direct LLM Calls**: OpenClaw calls LLM directly
- **Tool Handling**: OpenClaw handles tools directly
- **Simpler Architecture**: IgniteRouter only decides, doesn't proxy
- **Faster**: One less HTTP hop

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
  "recommendedModel": "deepseek/deepseek-chat",
  "tier": "MEDIUM",
  "taskType": "general",
  "complexityScore": 0.45,
  "reasoning": "Medium complexity task, tool-capable model selected",
  "alternatives": [{ "model": "xiaomi/mimo-v2-flash", "tier": "SIMPLE", "providerName": "xiaomi" }],
  "capabilities": {
    "supportsVision": false,
    "supportsTools": true,
    "supportsStreaming": true,
    "contextWindow": 131072
  },
  "routingLatencyMs": 3
}
```

## Configuration

### OpenClaw Config

Add your providers in `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://api.deepseek.com",
        "api": "openclaw-completions",
        "apiKey": "sk-your-key",
        "models": [
          {
            "id": "deepseek-chat",
            "input": ["text"],
            "cost": { "input": 0.28, "output": 0.42 },
            "contextWindow": 131072
          }
        ]
      },
      "xiaomi": {
        "baseUrl": "https://api.xiaomimimo.com/v1",
        "api": "openclaw-completions",
        "models": [
          {
            "id": "mimo-v2-flash",
            "input": ["text"],
            "cost": { "input": 0, "output": 0 },
            "contextWindow": 262144
          }
        ]
      }
    }
  },
  "plugins": {
    "entries": {
      "igniterouter": {
        "enabled": true,
        "config": {
          "defaultPriority": "cost"
        }
      }
    }
  }
}
```

### Provider-to-Tier Mapping

| Provider | Model                | Tier      |
| -------- | -------------------- | --------- |
| deepseek | deepseek-chat        | MEDIUM    |
| deepseek | deepseek-reasoner    | REASONING |
| xiaomi   | mimo-v2-flash        | SIMPLE    |
| xiaomi   | mimo-v2-pro          | REASONING |
| mistral  | mistral-large-latest | COMPLEX   |

Tier is inferred from cost if not explicitly mapped:

| Cost            | Tier      |
| --------------- | --------- |
| FREE            | SIMPLE    |
| < $0.50/M       | SIMPLE    |
| $0.50 - $1.50/M | MEDIUM    |
| $1.50 - $3.00/M | COMPLEX   |
| > $3.00/M       | REASONING |

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

## Task Types

| Task Type | When it triggers                  | Example                  |
| --------- | --------------------------------- | ------------------------ |
| Vision    | Image in content                  | "What is in this image?" |
| Agentic   | tools array present               | "Search and summarize"   |
| Reasoning | Keywords: prove, analyse, compare | "Compare SQL vs NoSQL"   |
| Creative  | Keywords: write, story, poem      | "Write a short story"    |
| Chat      | Default                           | "Hello, how are you?"    |

## Complexity Tiers

| Tier      | Score    | Description             |
| --------- | -------- | ----------------------- |
| SIMPLE    | 0.0-0.3  | Basic questions         |
| MEDIUM    | 0.3-0.6  | Explanations, summaries |
| COMPLEX   | 0.6-0.85 | Code, technical tasks   |
| REASONING | 0.85-1.0 | proofs, analysis        |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenClaw                               │
│  1. Receives user message                                    │
│  2. Calls IgniteRouter /v1/decide                            │
│  3. Gets recommended model                                   │
│  4. Calls LLM directly                                      │
│  5. Handles tools directly                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   IgniteRouter (Decision-Only)                │
│  1. Receives decision request                               │
│  2. Classifies task type (Agentic, Vision, etc.)            │
│  3. Scores complexity (0-1)                                 │
│  4. Selects best model from providers                       │
│  5. Returns recommendation                                  │
│                                                               │
│  NO LLM CALLS - Only provides decisions                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM Providers                             │
│  OpenClaw calls directly:                                    │
│  - deepseek (https://api.deepseek.com)                      │
│  - xiaomi (https://api.xiaomimimo.com/v1)                   │
│  - mistral (https://api.mistral.ai/v1)                      │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File                        | Purpose                    |
| --------------------------- | -------------------------- |
| `src/index.ts`              | Plugin registration        |
| `src/decide-endpoint.ts`    | Decision endpoint handler  |
| `src/routing-engine.ts`     | Core routing logic         |
| `src/task-classifier.ts`    | Task classification        |
| `src/complexity-scorer.ts`  | Complexity scoring         |
| `src/priority-selector.ts`  | Provider selection         |
| `src/openclaw-providers.ts` | Load providers from config |

## Removed (Not needed in decision-only mode)

- `src/proxy.ts` - Full proxy server
- `src/fallback-caller.ts` - LLM calling with fallback
- `src/provider-url-builder.ts` - URL building for upstream calls

## License

PolyForm Noncommercial 1.0.0
