import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { classifyTask, TaskType } from '../src/task-classifier.js'
import { scoreToTier, scoreComplexity, ComplexityTier } from '../src/complexity-scorer.js'
import { detectOverride } from '../src/override-detector.js'
import { selectCandidates } from '../src/priority-selector.js'
import { route } from '../src/routing-engine.js'
import * as scorer from '../src/complexity-scorer.js'
import { buildUpstreamRequest, stripProviderPrefix, getProviderBaseUrl } from '../src/provider-url-builder.js'
import { callWithFallback, classifyHttpError } from '../src/fallback-caller.js'
import { loadProviders } from '../src/user-providers.js'
import { startProxy } from '../src/index.js'
import http from 'node:http'

const TEST_CONFIG = {
  defaultPriority: 'cost' as const,
  providers: [
    // SIMPLE tier — cheap, no vision, no tools
    {
      id: 'openai/gpt-4o-mini',
      apiKey: 'test-key-mini',
      tier: 'SIMPLE' as const,
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.60,
      avgLatencyMs: 400,
      isLocal: false,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    // SIMPLE tier — vision capable, specialised for vision
    {
      id: 'google/gemini-2.5-flash',
      apiKey: 'test-key-google',
      tier: 'SIMPLE' as const,
      contextWindow: 1000000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.60,
      avgLatencyMs: 400,
      isLocal: false,
      specialisedFor: ['vision'],
      avoidFor: [],
      priorityForTasks: { vision: 1 }
    },
    // MEDIUM tier — local, free, no tools
    {
      id: 'ollama/llama3:8b',
      apiKey: undefined,
      baseUrl: 'http://localhost:11434',
      tier: 'MEDIUM' as const,
      contextWindow: 64000,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMToken: 0,
      outputPricePerMToken: 0,
      avgLatencyMs: 500,
      isLocal: true,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    // COMPLEX tier — full featured
    {
      id: 'openai/gpt-4o',
      apiKey: 'test-key-gpt4o',
      tier: 'COMPLEX' as const,
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 2.50,
      outputPricePerMToken: 10.00,
      avgLatencyMs: 800,
      isLocal: false,
      specialisedFor: ['reasoning'],
      avoidFor: [],
      priorityForTasks: {}
    },
    // EXPERT tier — most capable, most expensive
    {
      id: 'anthropic/claude-opus-4',
      apiKey: 'test-key-opus',
      tier: 'EXPERT' as const,
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 15.00,
      outputPricePerMToken: 75.00,
      avgLatencyMs: 1800,
      isLocal: false,
      specialisedFor: ['deep', 'reasoning'],
      avoidFor: [],
      priorityForTasks: {}
    }
  ]
}

const MOCK_LLM_RESPONSE = {
  id: 'chatcmpl-test-123',
  object: 'chat.completion',
  model: 'test-model',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'This is a test response.' },
    finish_reason: 'stop'
  }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
}

function createMockResponse(body: any, status = 200) {
  const jsonStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(jsonStr),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(jsonStr));
        controller.close();
      }
    })
  };
}

describe('GROUP A — Task Classification', () => {
  const testCases = [
    { id: 'A01', prompt: "hello how are you", expected: TaskType.Chat },
    { id: 'A02', prompt: "what is the capital of France", expected: TaskType.Chat },
    { id: 'A03', prompt: "translate hello to Spanish", expected: TaskType.Chat },
    { id: 'A04', prompt: "write a short story about a robot", expected: TaskType.Creative },
    { id: 'A05', prompt: "brainstorm 5 startup ideas", expected: TaskType.Creative },
    { id: 'A06', prompt: "write a poem about rain", expected: TaskType.Creative },
    { id: 'A07', prompt: "analyse the tradeoffs between microservices and monolith", expected: TaskType.Reasoning },
    { id: 'A08', prompt: "compare React vs Vue for a large project", expected: TaskType.Reasoning },
    { id: 'A09', prompt: "should I use PostgreSQL or MongoDB?", expected: TaskType.Reasoning },
    { id: 'A12', prompt: "prove that there are infinitely many prime numbers step by step formally", expected: TaskType.Deep },
  ]

  testCases.forEach(({ id, prompt, expected }) => {
    it(`${id}: "${prompt}" -> ${expected}`, () => {
      const result = classifyTask([{ role: 'user', content: prompt }])
      expect(result.taskType).toBe(expected)
      expect(['high', 'signal', 'keyword', 'default']).toContain(result.confidence)
      expect(result.reason).toBeTruthy()
    })
  })

  it('A10: messages with tools array -> TaskType.Agentic', () => {
    const result = classifyTask([{ role: 'user', content: "help me" }], [{ type: 'function' }])
    expect(result.taskType).toBe(TaskType.Agentic)
  })

  it('A11: messages with image_url -> TaskType.Vision', () => {
    const result = classifyTask([{ role: 'user', content: [{ type: 'image_url', image_url: { url: '...' } }] }])
    expect(result.taskType).toBe(TaskType.Vision)
  })
})

describe('GROUP B — Complexity Scoring', () => {
  it('B01: scoreToTier(0.05) === ComplexityTier.Simple', () => expect(scoreToTier(0.05)).toBe(ComplexityTier.Simple))
  it('B02: scoreToTier(0.29) === ComplexityTier.Simple', () => expect(scoreToTier(0.29)).toBe(ComplexityTier.Simple))
  it('B03: scoreToTier(0.30) === ComplexityTier.Medium', () => expect(scoreToTier(0.30)).toBe(ComplexityTier.Medium))
  it('B04: scoreToTier(0.59) === ComplexityTier.Medium', () => expect(scoreToTier(0.59)).toBe(ComplexityTier.Medium))
  it('B05: scoreToTier(0.60) === ComplexityTier.Complex', () => expect(scoreToTier(0.60)).toBe(ComplexityTier.Complex))
  it('B06: scoreToTier(0.84) === ComplexityTier.Complex', () => expect(scoreToTier(0.84)).toBe(ComplexityTier.Complex))
  it('B07: scoreToTier(0.85) === ComplexityTier.Expert', () => expect(scoreToTier(0.85)).toBe(ComplexityTier.Expert))
  it('B08: scoreToTier(0.99) === ComplexityTier.Expert', () => expect(scoreToTier(0.99)).toBe(ComplexityTier.Expert))

  it('B09: scoreComplexity("hi") -> score < 0.30', async () => {
    const res = await scoreComplexity("hi")
    expect(res.score).toBeLessThan(0.30)
    expect(res.tier).toBe(ComplexityTier.Simple)
    expect(res.method).toBe('keyword-fallback')
  })

  it('B10: scoreComplexity("explain how TCP/IP works") -> score >= 0.30', async () => {
    const res = await scoreComplexity("explain how TCP/IP works")
    expect(res.score).toBeGreaterThanOrEqual(0.30)
  })

  it('B11: scoreComplexity reasoning -> score >= 0.60', async () => {
    const res = await scoreComplexity("analyse the architectural tradeoffs in detail step by step")
    expect(res.score).toBeGreaterThanOrEqual(0.60)
  })

  it('B12: scoreComplexity formal -> score >= 0.70', async () => {
    const res = await scoreComplexity("prove this theorem formally step by step comprehensively")
    expect(res.score).toBeGreaterThanOrEqual(0.70)
  })

  it('B13: long prompt higher score', async () => {
    const short = await scoreComplexity("write a story")
    const long = await scoreComplexity("write a story " + "a".repeat(2500))
    expect(long.score).toBeGreaterThan(short.score)
  })

  it('B14: mock fetch to throw for localhost:8500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const res = await scoreComplexity("hi")
    expect(res.method).toBe('keyword-fallback')
    vi.unstubAllGlobals()
  })
})

describe('GROUP C — Override Detection', () => {
  const providers = TEST_CONFIG.providers as any[]
  
  it('C01: requestedModel="openai/gpt-4o"', () => {
    const res = detectOverride([], "openai/gpt-4o", providers)
    expect(res.detected).toBe(true)
    expect(res.source).toBe('api-field')
    expect(res.modelId).toBe('openai/gpt-4o')
  })

  it('C02: requestedModel="igniterouter/auto"', () => expect(detectOverride([], "igniterouter/auto", providers).detected).toBe(false))
  it('C03: requestedModel="auto"', () => expect(detectOverride([], "auto", providers).detected).toBe(false))
  it('C04: requestedModel="blockrun/auto"', () => expect(detectOverride([], "blockrun/auto", providers).detected).toBe(false))
  it('C05: requestedModel="smartrouter/auto"', () => expect(detectOverride([], "smartrouter/auto", providers).detected).toBe(false))

  it('C06: message="/model openai/gpt-4o do this task"', () => {
    const res = detectOverride([{ role: 'user', content: "/model openai/gpt-4o do this task" }], undefined, providers)
    expect(res.detected).toBe(true)
    expect(res.source).toBe('slash-command')
  })

  it('C07: message="/model anthropic/claude-opus-4"', () => {
    const res = detectOverride([{ role: 'user', content: "/model anthropic/claude-opus-4" }], undefined, providers)
    expect(res.modelId).toBe('anthropic/claude-opus-4')
  })

  it('C08: message="use gpt-4o for this task"', () => {
    const res = detectOverride([{ role: 'user', content: "use gpt-4o for this task" }], undefined, providers)
    expect(res.detected).toBe(true)
    expect(res.source).toBe('prompt')
  })

  it('C09: message="@openai/gpt-4o help me"', () => {
    const res = detectOverride([{ role: 'user', content: "@openai/gpt-4o help me" }], undefined, providers)
    expect(res.detected).toBe(true)
    expect(res.source).toBe('prompt')
  })

  it('C10: message="use the best model available"', () => expect(detectOverride([{ role: 'user', content: "use the best model available" }], undefined, providers).detected).toBe(false))
  it('C11: message="hello how are you"', () => expect(detectOverride([{ role: 'user', content: "hello how are you" }], undefined, providers).detected).toBe(false))

  it('C12: requestedModel="unknown/model-xyz"', () => {
    const res = detectOverride([], "unknown/model-xyz", providers)
    expect(res.detected).toBe(true)
    expect(res.notConfigured).toBe(true)
  })
})

describe('GROUP D — Candidate Selection', () => {
  const providers = TEST_CONFIG.providers as any[]

  it('D01: SIMPLE tier, Chat task, cost priority', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Chat, 'cost', { hasImages: false, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(['openai/gpt-4o-mini', 'google/gemini-2.5-flash']).toContain(res.candidates[0].provider.id)
    // Claude Opus is EXPERT, tier distance is 3, base score 10. Low cost mini is 100+20=120. Opus is 10-20=-10.
    expect(res.candidates.some(c => c.provider.id === 'anthropic/claude-opus-4' && res.candidates.indexOf(c) < 3)).toBe(false)
  })

  it('D02: SIMPLE tier, Vision task, cost priority', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Vision, 'cost', { hasImages: true, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(res.candidates[0].provider.id).toBe('google/gemini-2.5-flash')
    expect(res.filtered.some(p => p.id === 'openai/gpt-4o-mini')).toBe(true)
    expect(res.filtered.some(p => p.id === 'ollama/llama3:8b')).toBe(true)
  })

  it('D03: MEDIUM tier, Reasoning task, cost priority', () => {
    const res = selectCandidates(providers, ComplexityTier.Medium, TaskType.Reasoning, 'cost', { hasImages: false, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(res.candidates.some(c => c.provider.id === 'ollama/llama3:8b')).toBe(true)
  })

  it('D04: COMPLEX tier, Reasoning task, cost priority', () => {
    const res = selectCandidates(providers, ComplexityTier.Complex, TaskType.Reasoning, 'cost', { hasImages: false, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(res.candidates.some(c => c.provider.id === 'openai/gpt-4o')).toBe(true)
    const idx4o = res.candidates.findIndex(c => c.provider.id === 'openai/gpt-4o')
    const idxOpus = res.candidates.findIndex(c => c.provider.id === 'anthropic/claude-opus-4')
    expect(idx4o).toBeLessThan(idxOpus)
  })

  it('D05: hasTools=true', () => {
    const res = selectCandidates(providers, ComplexityTier.Medium, TaskType.Agentic, 'cost', { hasImages: false, hasTools: true, needsStreaming: false, estimatedTokens: 100 })
    expect(res.filtered.some(p => p.id === 'ollama/llama3:8b')).toBe(true)
    expect(res.filterReasons.get('ollama/llama3:8b')).toContain('tool')
  })

  it('D06: estimatedTokens=70000', () => {
    const res = selectCandidates(providers, ComplexityTier.Medium, TaskType.Chat, 'cost', { hasImages: false, hasTools: false, estimatedTokens: 70000, needsStreaming: false })
    expect(res.filtered.some(p => p.id === 'ollama/llama3:8b')).toBe(true)
    expect(res.filterReasons.get('ollama/llama3:8b')).toContain('context')
  })

  it('D07: speed priority, SIMPLE tier', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Chat, 'speed', { hasImages: false, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(['openai/gpt-4o-mini', 'google/gemini-2.5-flash']).toContain(res.candidates[0].provider.id)
    const topLatency = res.candidates[0].provider.avgLatencyMs
    const nextLatency = res.candidates.find(c => c.provider.id === 'ollama/llama3:8b')?.provider.avgLatencyMs
    if (nextLatency) expect(topLatency).toBeLessThanOrEqual(nextLatency)
  })

  it('D08: quality priority', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Chat, 'quality', { hasImages: false, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    // In quality mode, 4o-mini (SIMPLE match) gets 100. Opus (EXPERT match + 25) gets 10 + 25 = 35. Mini still higher.
    expect(res.candidates[0].provider.id).toBe('openai/gpt-4o-mini')
  })

  it('D09: priorityForTasks override — vision', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Vision, 'cost', { hasImages: true, hasTools: false, needsStreaming: false, estimatedTokens: 100 })
    expect(res.candidates[0].provider.id).toBe('google/gemini-2.5-flash')
    expect(res.candidates[0].priorityScore).toBeGreaterThanOrEqual(999)
  })

  it('D10: all providers filtered', () => {
    const res = selectCandidates(providers, ComplexityTier.Simple, TaskType.Chat, 'cost', { hasImages: false, hasTools: false, estimatedTokens: 2000000, needsStreaming: false })
    expect(res.candidates.length).toBe(0)
    expect(res.filtered.length).toBe(providers.length)
  })
})

describe('GROUP E — Routing Engine End to End', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('E01: Simple chat prompt', async () => {
    vi.spyOn(scorer, 'scoreComplexity').mockResolvedValue({ score: 0.15, tier: ComplexityTier.Simple, method: 'keyword-fallback', latencyMs: 1 })
    const res = await route({ messages: [{ role: 'user', content: 'hello' }], estimatedTokens: 100 }, TEST_CONFIG as any)
    expect(res.taskType).toBe(TaskType.Chat)
    expect(res.tier).toBe(ComplexityTier.Simple)
    expect(['openai/gpt-4o-mini', 'google/gemini-2.5-flash']).toContain(res.candidateProviders[0].id)
  })

  it('E02: Complex reasoning', async () => {
    vi.spyOn(scorer, 'scoreComplexity').mockResolvedValue({ score: 0.72, tier: ComplexityTier.Complex, method: 'keyword-fallback', latencyMs: 1 })
    const res = await route({ messages: [{ role: 'user', content: 'analyse' }], estimatedTokens: 100 }, TEST_CONFIG as any)
    expect(res.taskType).toBe(TaskType.Reasoning)
    expect(res.candidateProviders.some(p => p.id === 'openai/gpt-4o')).toBe(true)
  })

  it('E03: Vision request', async () => {
    vi.spyOn(scorer, 'scoreComplexity').mockResolvedValue({ score: 0.25, tier: ComplexityTier.Simple, method: 'keyword-fallback', latencyMs: 1 })
    const res = await route({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '...' } }] }], estimatedTokens: 100 }, TEST_CONFIG as any)
    expect(res.taskType).toBe(TaskType.Vision)
    expect(res.candidateProviders[0].id).toBe('google/gemini-2.5-flash')
  })

  it('E04: Tools request', async () => {
    vi.spyOn(scorer, 'scoreComplexity').mockResolvedValue({ score: 0.35, tier: ComplexityTier.Medium, method: 'keyword-fallback', latencyMs: 1 })
    const res = await route({ messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'test' } }], estimatedTokens: 100 }, TEST_CONFIG as any)
    expect(res.taskType).toBe(TaskType.Agentic)
    expect(res.candidateProviders.every(p => p.id !== 'ollama/llama3:8b')).toBe(true)
  })

  it('E05: Override via api-field', async () => {
    const res = await route({ messages: [{ role: 'user', content: 'hi' }], requestedModel: 'openai/gpt-4o' }, TEST_CONFIG as any)
    expect(res.override?.detected).toBe(true)
    expect(res.candidateProviders).toHaveLength(1)
    expect(res.candidateProviders[0].id).toBe('openai/gpt-4o')
  })

  it('E06: Override via slash command', async () => {
    const res = await route({ messages: [{ role: 'user', content: '/model anthropic/claude-opus-4 help me' }] }, TEST_CONFIG as any)
    expect(res.override?.source).toBe('slash-command')
    expect(res.candidateProviders[0].id).toBe('anthropic/claude-opus-4')
  })

  it('E07: Override with unconfigured model', async () => {
    const res = await route({ messages: [{ role: 'user', content: 'hi' }], requestedModel: 'unknown/model-x' }, TEST_CONFIG as any)
    expect(res.error).toContain('not configured')
  })

  it('E08: estimatedTokens=70000', async () => {
    vi.spyOn(scorer, 'scoreComplexity').mockResolvedValue({ score: 0.45, tier: ComplexityTier.Medium, method: 'keyword-fallback', latencyMs: 1 })
    const res = await route({ messages: [{ role: 'user', content: 'hi' }], estimatedTokens: 70000 }, TEST_CONFIG as any)
    expect(res.candidateProviders.every(p => p.id !== 'ollama/llama3:8b')).toBe(true)
  })

  it('E09: Empty providers config', async () => {
    const res = await route({ messages: [{ role: 'user', content: 'hi' }] }, { defaultPriority: 'cost', providers: [] } as any)
    expect(res.candidateProviders).toBeDefined()
  })

  it('E10: Latency check', async () => {
    const res = await route({ messages: [{ role: 'user', content: 'hi' }] }, TEST_CONFIG as any)
    expect(res.latencyMs).toBeLessThan(100)
  })
})

describe('GROUP F — Provider URL Builder', () => {
  it('F01: openai/gpt-4o', () => {
    const p = TEST_CONFIG.providers.find(p => p.id === 'openai/gpt-4o') as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.headers['Authorization']).toBe('Bearer test-key-gpt4o')
    expect((req.body as any).model).toBe('gpt-4o')
  })

  it('F02: anthropic/claude-opus-4', () => {
    const p = TEST_CONFIG.providers.find(p => p.id === 'anthropic/claude-opus-4') as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers['x-api-key']).toBe('test-key-opus')
    expect(req.headers['anthropic-version']).toBeDefined()
    expect((req.body as any).model).toBe('claude-opus-4')
  })

  it('F03: google/gemini-2.5-flash', () => {
    const p = TEST_CONFIG.providers.find(p => p.id === 'google/gemini-2.5-flash') as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toContain('generativelanguage.googleapis.com')
    expect(req.url).toContain('test-key-google')
  })

  it('F04: deepseek/deepseek-chat', () => {
    const p = { id: 'deepseek/deepseek-chat', apiKey: 'test-deepseek-key' } as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(req.headers['Authorization']).toBe('Bearer test-deepseek-key')
    expect((req.body as any).model).toBe('deepseek-chat')
  })

  it('F05: openrouter/auto', () => {
    const p = { id: 'openrouter/auto', apiKey: 'test-key' } as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers['Authorization']).toContain('Bearer')
    expect((req.body as any).model).toBe('auto')
  })

  it('F06: ollama/llama3:8b', () => {
    const p = TEST_CONFIG.providers.find(p => p.id === 'ollama/llama3:8b') as any
    const req = buildUpstreamRequest(p, { model: 'igniterouter/auto', messages: [] })
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(req.headers['Authorization']).toBeUndefined()
    expect((req.body as any).model).toBe('llama3:8b')
  })

  it('F07-F11: stripProviderPrefix', () => {
    expect(stripProviderPrefix('openai/gpt-4o')).toBe('gpt-4o')
    expect(stripProviderPrefix('ollama/llama3:8b')).toBe('llama3:8b')
    expect(stripProviderPrefix('anthropic/claude-opus-4')).toBe('claude-opus-4')
    expect(stripProviderPrefix('google/gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(stripProviderPrefix('noprefix')).toBe('noprefix')
  })

  it('F12: Anthropic format transformation', () => {
    const p = TEST_CONFIG.providers.find(p => p.id === 'anthropic/claude-opus-4') as any
    const messages = [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Hello' }]
    const req = buildUpstreamRequest(p, { messages })
    const body = req.body as any
    expect(body.system).toBe('You are helpful.')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
  })
})

describe('GROUP G — Fallback Caller', () => {
  const candidates = TEST_CONFIG.providers.slice(0, 3).map(p => ({ provider: p as any, priorityScore: 0, reasons: [] }))

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('G01: First call succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockResponse(MOCK_LLM_RESPONSE) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(true)
    expect(res.attempts).toHaveLength(1)
    expect(res.finalResponse).toBeDefined()
  })

  it('G02: First call returns 429, second succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createMockResponse({ error: 'rate limit' }, 429) as any)
      .mockResolvedValueOnce(createMockResponse(MOCK_LLM_RESPONSE) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(true)
    expect(res.attempts).toHaveLength(2)
    expect(res.attempts[0].failureReason).toBe('rate-limit')
  })

  it('G03: First call returns 500, second 503, third succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createMockResponse('error', 500) as any)
      .mockResolvedValueOnce(createMockResponse('error', 503) as any)
      .mockResolvedValueOnce(createMockResponse(MOCK_LLM_RESPONSE) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(true)
    expect(res.attempts).toHaveLength(3)
    expect(res.attempts[0].failureReason).toBe('server-error')
  })

  it('G04: Call returns 400 — stop chain', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockResponse('bad', 400) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(false)
    expect(res.attempts).toHaveLength(1)
    expect(res.attempts[0].failureReason).toBe('bad-request')
  })

  it('G05: Call returns 401 — skip and continue', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createMockResponse('unauthorized', 401) as any)
      .mockResolvedValueOnce(createMockResponse(MOCK_LLM_RESPONSE) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(true)
    expect(res.attempts).toHaveLength(2)
    expect(res.attempts[0].failureReason).toBe('auth-error')
  })

  it('G06: All candidates fail', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockResponse('error', 503) as any)
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }))
    expect(res.success).toBe(false)
    expect(res.attempts).toHaveLength(candidates.length)
    expect(res.errorSummary).toContain('tried')
  })

  it('G07: Timeout', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    })
    const res = await callWithFallback(candidates, () => ({ url: 'http://test.com', init: {} }), { timeoutMs: 50 })
    expect(res.attempts[0].failureReason).toBe('timeout')
  })

  it('G08-G14: classifyHttpError', () => {
    expect(classifyHttpError(429)).toBe('rate-limit')
    expect(classifyHttpError(500)).toBe('server-error')
    expect(classifyHttpError(503)).toBe('server-error')
    expect(classifyHttpError(400)).toBe('bad-request')
    expect(classifyHttpError(401)).toBe('auth-error')
    expect(classifyHttpError(403, 'quota exceeded')).toBe('quota-exceeded')
    expect(classifyHttpError(403, 'forbidden')).toBe('auth-error')
  })
})

describe('GROUP H — Provider Config Loading', () => {
  it('H01: loadProviders(undefined)', () => {
    const cfg = loadProviders(undefined as any)
    expect(cfg.providers).toEqual([])
    expect(cfg.defaultPriority).toBe('cost')
  })

  it('H02: loadProviders({})', () => expect(loadProviders({} as any).providers).toEqual([]))
  it('H03: loadProviders({ providers: null })', () => expect(loadProviders({ providers: null } as any).providers).toEqual([]))

  it('H04: Known model gpt-4o contextWindow', () => {
    const cfg = loadProviders({ providers: [{ id: 'openai/gpt-4o', apiKey: 'x', tier: 'COMPLEX' }] } as any)
    expect(cfg.providers[0].contextWindow).toBe(128000)
  })

  it('H05: Known model gpt-4o supportsVision', () => {
    const cfg = loadProviders({ providers: [{ id: 'openai/gpt-4o', apiKey: 'x', tier: 'COMPLEX' }] } as any)
    expect(cfg.providers[0].supportsVision).toBe(true)
  })

  it('H06: Known model claude-haiku-4 price', () => {
    const cfg = loadProviders({ providers: [{ id: 'anthropic/claude-haiku-4', apiKey: 'x', tier: 'SIMPLE' }] } as any)
    expect(cfg.providers[0].inputPricePerMToken).toBe(0.80)
  })

  it('H07: Ollama model', () => {
    const cfg = loadProviders({ providers: [{ id: 'ollama/llama3', tier: 'MEDIUM' }] } as any)
    expect(cfg.providers[0].isLocal).toBe(true)
    expect(cfg.providers[0].inputPricePerMToken).toBe(0)
  })

  it('H08: Unknown model id', () => {
    const cfg = loadProviders({ providers: [{ id: 'unknown/model', tier: 'SIMPLE' }] } as any)
    expect(cfg.providers[0].contextWindow).toBeDefined()
  })

  it('H09: Provider with null id', () => {
    const cfg = loadProviders({ providers: [{ id: null, tier: 'SIMPLE' }] } as any)
    expect(cfg.providers).toHaveLength(0)
  })

  it('H11: defaultPriority="speed"', () => {
    const cfg = loadProviders({ defaultPriority: 'speed', providers: [] } as any)
    expect(cfg.defaultPriority).toBe('speed')
  })

  it('H12: defaultPriority missing', () => expect(loadProviders({ providers: [] } as any).defaultPriority).toBe('cost'))
})

describe('GROUP I — Proxy HTTP Endpoints', () => {
  let proxyHandle: any
  const TEST_PORT = 19500

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com') || url.includes('openrouter') || 
          url.includes('anthropic') || url.includes('google') || 
          url.includes('deepseek') || url.includes('localhost:11434')) {
        return createMockResponse(MOCK_LLM_RESPONSE)
      }
      return createMockResponse({ score: 0.5 })
    }))

    const config = loadProviders({
      defaultPriority: 'cost',
      providers: [
        { id: 'openai/gpt-4o-mini', apiKey: 'test-key', tier: 'SIMPLE' },
        { id: 'openai/gpt-4o', apiKey: 'test-key', tier: 'COMPLEX' },
        { id: 'google/gemini-2.5-flash', apiKey: 'test-key', tier: 'SIMPLE', 
          specialisedFor: ['vision'], priorityForTasks: { vision: 1 } }
      ]
    } as any)
    proxyHandle = await startProxy({ port: TEST_PORT, igniteConfig: config, cacheConfig: { enabled: false } })
  }, 10000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (proxyHandle) await proxyHandle.close()
  })

  function makeRequest(path: string, method = 'GET', body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = http.request({ port: TEST_PORT, path, method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' } }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: data ? JSON.parse(data) : null }))
      })
      req.on('error', reject)
      if (body) req.write(JSON.stringify(body))
      req.end()
    })
  }

  it('I01: GET /health', async () => {
    const res = await makeRequest('/health')
    expect(res.status).toBe(200)
    expect(res.data.status).toBe('ok')
    expect(res.data.plugin).toBe('igniterouter')
    expect(res.data.providers).toBe(3)
  })

  it('I02: GET /v1/models', async () => {
    const res = await makeRequest('/v1/models')
    expect(res.data.data.some(m => m.id === 'igniterouter/auto')).toBe(true)
    expect(res.data.data.some(m => m.id === 'openai/gpt-4o-mini')).toBe(true)
  })

  it('I03: POST /v1/chat/completions — simple chat', async () => {
    const res = await makeRequest('/v1/chat/completions', 'POST', { model: 'igniterouter/auto', messages: [{ role: 'user', content: 'hello' }] })
    expect(res.status).toBe(200)
    expect(res.data.choices[0].message.content).toBeDefined()
    expect(res.headers['x-igniterouter-model']).toBeDefined()
  })

  it('I04: POST /v1/chat/completions — explicit override', async () => {
    const res = await makeRequest('/v1/chat/completions', 'POST', { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hello' }] })
    expect(res.headers['x-igniterouter-model']).toBe('openai/gpt-4o')
  })

  it('I05: POST /v1/chat/completions — unknown model', async () => {
    const res = await makeRequest('/v1/chat/completions', 'POST', { model: 'unknown/not-configured', messages: [{ role: 'user', content: 'hello' }] })
    expect(res.status).toBe(400)
    expect(res.data.error.message).toMatch(/not configured|not in your provider/)
  })

  it('I06: POST /v1/chat/completions — slash command', async () => {
    const fetchMock = vi.mocked(global.fetch)
    const callsBefore = fetchMock.mock.calls.length
    const res = await makeRequest('/v1/chat/completions', 'POST', { model: 'igniterouter/auto', messages: [{ role: 'user', content: '/model list' }] })
    expect(res.status).toBe(200)
    expect(res.data.choices[0].message.content).toContain('Configured')
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('I07: POST /v1/chat/completions — vision request', async () => {
    const res = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'igniterouter/auto',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }, { type: 'text', text: 'what is in this image?' }] }]
    })
    expect(res.headers['x-igniterouter-task']).toBe('vision')
    expect(res.headers['x-igniterouter-model']).toBe('google/gemini-2.5-flash')
  })

  it('I08: POST /v1/chat/completions — fallback on 429', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('score')) return createMockResponse({ score: 0.1 })
      callCount++
      if (callCount === 1) return createMockResponse({ error: 'rate limited' }, 429)
      return createMockResponse(MOCK_LLM_RESPONSE)
    }))
    const res = await makeRequest('/v1/chat/completions', 'POST', { model: 'igniterouter/auto', messages: [{ role: 'user', content: 'hello' }] })
    expect(res.status).toBe(200)
    expect(callCount).toBeGreaterThanOrEqual(2)
  })
})

describe('Routing Decision Table', () => {
  it('prints routing table for 10 prompts', async () => {
    const scenarios = [
      { prompt: 'hello how are you',                              score: 0.10, tier: 'SIMPLE',  tools: false, image: false },
      { prompt: 'what is the capital of France',                  score: 0.15, tier: 'SIMPLE',  tools: false, image: false },
      { prompt: 'write a short story about a brave robot',        score: 0.25, tier: 'SIMPLE',  tools: false, image: false },
      { prompt: 'explain how TCP/IP works',                       score: 0.45, tier: 'MEDIUM',  tools: false, image: false },
      { prompt: 'analyse microservices vs monolith tradeoffs',    score: 0.65, tier: 'COMPLEX', tools: false, image: false },
      { prompt: 'prove that sqrt(2) is irrational step by step',  score: 0.88, tier: 'EXPERT',  tools: false, image: false },
      { prompt: 'search the web and summarise results',           score: 0.35, tier: 'MEDIUM',  tools: true,  image: false },
      { prompt: 'what is in this image?',                         score: 0.20, tier: 'SIMPLE',  tools: false, image: true  },
      { prompt: '/model openai/gpt-4o do this task',              score: 0.40, tier: 'MEDIUM',  tools: false, image: false },
      { prompt: 'write a comprehensive research paper on AI',     score: 0.90, tier: 'EXPERT',  tools: false, image: false },
    ]

    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗')
    console.log('║               IgniteRouter — Live Routing Decision Table                                ║')
    console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣')
    console.log(
      '║ ' + 'Prompt'.padEnd(44) +
      'Task'.padEnd(11) +
      'Tier'.padEnd(10) +
      'Model Selected'.padEnd(25) +
      ' ║'
    )
    console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣')

    for (const s of scenarios) {
      vi.spyOn(scorer, 'scoreComplexity').mockResolvedValueOnce({
        score: s.score,
        tier: s.tier as any,
        method: 'keyword-fallback',
        latencyMs: 1
      })

      const messages: any[] = s.image
        ? [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
            { type: 'text', text: s.prompt }
          ]}]
        : [{ role: 'user', content: s.prompt }]

      const tools = s.tools ? [{ type: 'function', function: { name: 'search' } }] : undefined

      const decision = await route(
        { messages, tools, estimatedTokens: 100, needsStreaming: false },
        TEST_CONFIG as any
      )

      const model = decision.candidateProviders[0]?.id ?? decision.error ?? 'ERROR'
      const task = decision.taskType ?? (decision.override?.detected ? 'override' : '?')
      const tier = decision.tier ?? (decision.override?.detected ? 'direct' : '?')
      const promptDisplay = s.prompt.length > 42 ? s.prompt.substring(0, 41) + '…' : s.prompt

      console.log(
        '║ ' + promptDisplay.padEnd(44) +
        String(task).padEnd(11) +
        String(tier).padEnd(10) +
        model.padEnd(25) +
        ' ║'
      )
    }

    console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝')
    console.log()

    expect(true).toBe(true)
  })
})
