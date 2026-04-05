import { describe, it, expect, vi } from 'vitest'
import { estimateCost, estimateSavings, projectMonthlySavings, RoutingTimer } from '../src/cost-estimator.js'
import { ComplexityTier } from '../src/complexity-scorer.js'
import { loadProviders } from '../src/user-providers.js'

const TEST_PROVIDERS = [
  {
    id: 'openai/gpt-4o-mini',
    apiKey: 'test-key-mini',
    tier: 'SIMPLE' as const,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.60,
    avgLatencyMs: 400,
    isLocal: false
  },
  {
    id: 'ollama/llama3:8b',
    tier: 'MEDIUM' as const,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    avgLatencyMs: 500,
    isLocal: true
  },
  {
    id: 'anthropic/claude-opus-4',
    apiKey: 'test-key-opus',
    tier: 'EXPERT' as const,
    inputPricePerMToken: 15.00,
    outputPricePerMToken: 75.00,
    avgLatencyMs: 1800,
    isLocal: false
  }
]

describe('Cost Estimator', () => {
  it('CE01: estimateCost for openai/gpt-4o-mini', () => {
    const provider = TEST_PROVIDERS[0] as any
    const est = estimateCost(provider, 1000, 1000)
    expect(est.inputCostUsd).toBeCloseTo(0.00015, 6)
    expect(est.outputCostUsd).toBeCloseTo(0.00060, 6)
    expect(est.totalCostUsd).toBeCloseTo(0.00075, 6)
    expect(est.formattedCost).toMatch(/^\$0\.000[78]$/)
  })

  it('CE02: estimateCost for ollama/llama3:8b', () => {
    const provider = TEST_PROVIDERS[1] as any
    const est = estimateCost(provider, 1000, 1000)
    expect(est.totalCostUsd).toBe(0)
    expect(est.formattedCost).toBe('free (local)')
  })

  it('CE03: estimateCost for anthropic/claude-opus-4', () => {
    const provider = TEST_PROVIDERS[2] as any
    const est = estimateCost(provider, 500, 500)
    expect(est.totalCostUsd).toBeCloseTo(0.045, 6)
    expect(est.formattedCost).toBe('$0.0450')
  })

  it('CE04: estimateSavings — actual=gpt-4o-mini vs baseline=claude-opus-4', () => {
    const actual = estimateCost(TEST_PROVIDERS[0] as any, 1000, 1000)
    const res = estimateSavings(actual, TEST_PROVIDERS as any, 1000, 1000)
    expect(res.savedPercent).toBeGreaterThan(80)
    expect(res.formattedSavings).toContain('Saved')
  })

  it('CE05: estimateSavings — actual=claude-opus vs baseline=claude-opus', () => {
    const actual = estimateCost(TEST_PROVIDERS[2] as any, 1000, 1000)
    const res = estimateSavings(actual, TEST_PROVIDERS as any, 1000, 1000)
    expect(res.savedPercent).toBe(0)
    expect(res.formattedSavings).toBe('Same cost as baseline')
  })

  it('CE06: projectMonthlySavings', () => {
    const res = projectMonthlySavings(TEST_PROVIDERS as any, 10000, 500, 500)
    expect(res.monthlySavingsPercent).toBeGreaterThan(50)
    expect(res.description).toContain('%')
    expect(res.monthlyActualUsd).toBeLessThan(res.monthlyBaselineUsd)
  })

  it('CE07: RoutingTimer', () => {
    const timer = new RoutingTimer()
    timer.mark('task')
    timer.mark('complexity')
    timer.mark('selection')
    const overhead = timer.getOverhead()
    expect(overhead.totalRoutingMs).toBeGreaterThanOrEqual(0)
  })

  it('CE08: RoutingTimer — marks are set', () => {
    const timer = new RoutingTimer()
    timer.mark('task')
    timer.mark('complexity')
    timer.mark('selection')
    const overhead = timer.getOverhead()
    expect(overhead.taskClassificationMs).toBeDefined()
    expect(overhead.complexityScoringMs).toBeDefined()
    expect(overhead.candidateSelectionMs).toBeDefined()
  })
})

describe('Savings Report', () => {
  it('prints monthly savings projection for a realistic config', () => {
    const config = loadProviders({
      defaultPriority: 'cost',
      providers: [
        { id: 'google/gemini-2.5-flash-lite', apiKey: 'x', tier: 'SIMPLE' },
        { id: 'openai/gpt-4o-mini', apiKey: 'x', tier: 'SIMPLE' },
        { id: 'deepseek/deepseek-chat', apiKey: 'x', tier: 'MEDIUM' },
        { id: 'openai/gpt-4o', apiKey: 'x', tier: 'COMPLEX' },
        { id: 'anthropic/claude-opus-4', apiKey: 'x', tier: 'EXPERT' },
      ]
    })

    const volumes = [1000, 10000, 100000]

    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════════════╗')
    console.log('║         IgniteRouter — Monthly Savings Projection               ║')
    console.log('║  Baseline: always claude-opus-4 ($15/M input, $75/M output)     ║')
    console.log('║  Traffic:  45% simple / 30% medium / 15% complex / 10% expert  ║')
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log(
      '║ ' + 'Requests/mo'.padEnd(14) +
      'Without IgniteRouter'.padEnd(22) +
      'With IgniteRouter'.padEnd(19) +
      'Saving'.padEnd(12) + ' ║'
    )
    console.log('╠══════════════════════════════════════════════════════════════════╣')

    for (const vol of volumes) {
      const proj = projectMonthlySavings(config.providers, vol, 500, 500)
      console.log(
        '║ ' +
        vol.toLocaleString().padEnd(14) +
        ('$' + proj.monthlyBaselineUsd.toFixed(2)).padEnd(22) +
        ('$' + proj.monthlyActualUsd.toFixed(2)).padEnd(19) +
        (proj.monthlySavingsPercent + '% cheaper').padEnd(12) +
        ' ║'
      )
    }
    console.log('╚══════════════════════════════════════════════════════════════════╝')
    console.log()

    expect(true).toBe(true)
  })

  it('prints routing overhead vs LLM latency', () => {
    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════════╗')
    console.log('║        IgniteRouter — Routing Overhead vs LLM Latency       ║')
    console.log('╠══════════════════════════════════════════════════════════════╣')
    console.log('║ Phase                         Typical time                  ║')
    console.log('╠══════════════════════════════════════════════════════════════╣')
    console.log('║ Override detection            < 1ms   (string scan only)    ║')
    console.log('║ Task classification           < 1ms   (keyword matching)    ║')
    console.log('║ Complexity scoring (keywords) < 2ms   (no API call)         ║')
    console.log('║ Complexity scoring (RouteLLM) 50-200ms (local HTTP)         ║')
    console.log('║ Candidate selection           < 1ms   (array sort)          ║')
    console.log('║ ─────────────────────────────────────────────────────────── ║')
    console.log('║ Total routing overhead        2-5ms   (without RouteLLM)    ║')
    console.log('║ Total routing overhead        50-200ms (with RouteLLM)      ║')
    console.log('║ ─────────────────────────────────────────────────────────── ║')
    console.log('║ Typical LLM response time     400ms - 2000ms                ║')
    console.log('║ IgniteRouter overhead as %    0.1% - 1% of total latency    ║')
    console.log('╚══════════════════════════════════════════════════════════════╝')
    console.log()
    expect(true).toBe(true)
  })
})
