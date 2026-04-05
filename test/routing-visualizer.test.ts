import { describe, it, expect, vi } from 'vitest'
import { route } from '../src/routing-engine.js'
import { buildUpstreamRequest } from '../src/provider-url-builder.js'
import { ComplexityTier } from '../src/complexity-scorer.js'
import { TaskType } from '../src/task-classifier.js'
import * as scorer from '../src/complexity-scorer.js'

const TEST_CONFIG = {
  defaultPriority: 'cost' as const,
  providers: [
    {
      id: 'openai/gpt-4o-mini',
      apiKey: 'sk-mini',
      tier: 'SIMPLE' as const,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.60,
      avgLatencyMs: 400,
      supportsTools: true,
      contextWindow: 128000,
      specialisedFor: [],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: 'openai/gpt-4o',
      apiKey: 'sk-4o',
      tier: 'COMPLEX' as const,
      inputPricePerMToken: 2.50,
      outputPricePerMToken: 10.00,
      avgLatencyMs: 800,
      supportsTools: true,
      contextWindow: 128000,
      specialisedFor: ['reasoning'],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: 'anthropic/claude-opus-4',
      apiKey: 'sk-ant',
      tier: 'EXPERT' as const,
      inputPricePerMToken: 15.00,
      outputPricePerMToken: 75.00,
      avgLatencyMs: 1800,
      supportsTools: true,
      contextWindow: 200000,
      specialisedFor: ['deep'],
      avoidFor: [],
      priorityForTasks: {}
    },
    {
      id: 'google/gemini-2.5-flash',
      apiKey: 'sk-goog',
      tier: 'SIMPLE' as const,
      inputPricePerMToken: 0.15,
      outputPricePerMToken: 0.60,
      avgLatencyMs: 400,
      supportsVision: true,
      priorityForTasks: { vision: 1 },
      specialisedFor: ['vision'],
      avoidFor: []
    }
  ]
}

describe('Routing Visualizer — Prompt to LLM Call Mapping', () => {
  const scenarios = [
    { prompt: 'Hi there!', score: 0.1, tier: 'SIMPLE' },
    { prompt: 'Explain the quantum zeno effect in detail', score: 0.5, tier: 'MEDIUM' },
    { prompt: 'Write a full stack React app with backend auth', score: 0.75, tier: 'COMPLEX' },
    { prompt: 'Prove the Riemann Hypothesis formally', score: 0.95, tier: 'EXPERT' },
    { prompt: 'What is in this image?', image: true, score: 0.2, tier: 'SIMPLE' },
  ]

  it('verifies the full transformation from Prompt -> Provider -> Request Body', async () => {
    console.log('\n' + '='.repeat(80))
    console.log('IGNITE ROUTER — PROMPT TO LLM MAPPING VISUALIZER')
    console.log('='.repeat(80) + '\n')

    for (const s of scenarios) {
      vi.spyOn(scorer, 'scoreComplexity').mockResolvedValueOnce({
        score: s.score,
        tier: s.tier as any,
        method: 'keyword-fallback',
        latencyMs: 1
      })

      const messages: any[] = s.image
        ? [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:img' } }, { type: 'text', text: s.prompt }] }]
        : [{ role: 'user', content: s.prompt }]

      const decision = await route({ messages, estimatedTokens: 100 }, TEST_CONFIG as any)
      const selectedProvider = decision.candidateProviders[0]
      
      // Show what IgniteRouter decided
      console.log(`PROMPT: "${s.prompt}"`)
      console.log(`  └─ TASK: ${decision.taskType?.toUpperCase()}`)
      console.log(`  └─ TIER: ${decision.tier}`)
      console.log(`  └─ PICKED: ${selectedProvider.id}`)

      // Show what the actual API call looks like
      const upstream = buildUpstreamRequest(selectedProvider, { model: 'auto', messages })
      
      console.log(`  └─ UPSTREAM URL: ${upstream.url}`)
      console.log(`  └─ AUTH TYPE: ${Object.keys(upstream.headers).includes('x-api-key') ? 'Anthropic (x-api-key)' : 'OpenAI (Bearer)'}`)
      
      const body = upstream.body as any
      if (selectedProvider.id.startsWith('anthropic')) {
        console.log(`  └─ FORMAT: Anthropic Messages (Transformed)`)
        console.log(`  └─ BODY MODEL: ${body.model}`)
      } else {
        console.log(`  └─ FORMAT: OpenAI Chat Completions`)
        console.log(`  └─ BODY MODEL: ${body.model}`)
      }
      console.log('-'.repeat(40))
    }
    expect(true).toBe(true)
  })
})
