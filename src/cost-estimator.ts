// src/cost-estimator.ts

import { UserProvider } from './user-providers.js'

export interface CostEstimate {
  modelId: string
  inputTokens: number
  outputTokens: number
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
  formattedCost: string   // e.g. "$0.0023" or "< $0.0001"
}

export interface SavingsEstimate {
  actualCostUsd: number
  baselineCostUsd: number    // cost if most expensive model was always called
  savedUsd: number
  savedPercent: number       // 0-100
  formattedSavings: string   // e.g. "Saved $0.021 (87%)"
}

export interface RoutingOverhead {
  taskClassificationMs: number
  complexityScoringMs: number
  candidateSelectionMs: number
  totalRoutingMs: number
}

// Calculate cost for a single request
export function estimateCost(
  provider: UserProvider,
  inputTokens: number,
  outputTokens: number
): CostEstimate {
  const inputCostUsd = (provider.inputPricePerMToken / 1_000_000) * inputTokens
  const outputCostUsd = (provider.outputPricePerMToken / 1_000_000) * outputTokens
  const totalCostUsd = inputCostUsd + outputCostUsd

  let formattedCost: string
  if (totalCostUsd === 0) {
    formattedCost = 'free (local)'
  } else if (totalCostUsd < 0.0001) {
    formattedCost = '< $0.0001'
  } else {
    formattedCost = '$' + totalCostUsd.toFixed(4)
  }

  return { 
    modelId: provider.id, inputTokens, outputTokens,
    inputCostUsd, outputCostUsd, totalCostUsd, formattedCost 
  }
}

// Calculate savings vs most expensive model in config
export function estimateSavings(
  actual: CostEstimate,
  allProviders: UserProvider[],
  inputTokens: number,
  outputTokens: number
): SavingsEstimate {
  // Find most expensive provider (highest input price)
  if (allProviders.length === 0) {
    return {
      actualCostUsd: actual.totalCostUsd,
      baselineCostUsd: actual.totalCostUsd,
      savedUsd: 0,
      savedPercent: 0,
      formattedSavings: 'Same cost as baseline'
    }
  }

  const mostExpensive = allProviders.reduce((max, p) =>
    p.inputPricePerMToken > max.inputPricePerMToken ? p : max
  , allProviders[0])

  const baselineCost = estimateCost(mostExpensive, inputTokens, outputTokens)
  const savedUsd = Math.max(0, baselineCost.totalCostUsd - actual.totalCostUsd)
  const savedPercent = baselineCost.totalCostUsd > 0
    ? Math.round((savedUsd / baselineCost.totalCostUsd) * 100)
    : 0

  const formattedSavings = savedPercent > 0
    ? `Saved $${savedUsd.toFixed(4)} vs ${mostExpensive.id} (${savedPercent}% cheaper)`
    : `Same cost as baseline`

  return {
    actualCostUsd: actual.totalCostUsd,
    baselineCostUsd: baselineCost.totalCostUsd,
    savedUsd,
    savedPercent,
    formattedSavings
  }
}

// Standard traffic distribution for monthly savings projection
// Based on RouteLLM research: typical workloads are ~45% simple, 
// ~30% medium, ~15% complex, ~10% expert
export interface MonthlySavingsProjection {
  monthlyRequestsEstimate: number
  avgCostPerRequestActual: number
  avgCostPerRequestBaseline: number
  monthlyActualUsd: number
  monthlyBaselineUsd: number
  monthlySavingsUsd: number
  monthlySavingsPercent: number
  description: string
}

export function projectMonthlySavings(
  providers: UserProvider[],
  monthlyRequests: number = 10000,
  avgInputTokens: number = 500,
  avgOutputTokens: number = 500
): MonthlySavingsProjection {
  // Traffic distribution assumption
  const distribution = [
    { tierKey: 'SIMPLE',  share: 0.45 },
    { tierKey: 'MEDIUM',  share: 0.30 },
    { tierKey: 'COMPLEX', share: 0.15 },
    { tierKey: 'EXPERT',  share: 0.10 },
  ]

  // Pick cheapest provider per tier (cost mode routing)
  let blendedActual = 0
  for (const { tierKey, share } of distribution) {
    const tierProviders = providers.filter(p => p.tier === tierKey)
    if (tierProviders.length === 0) {
      // no provider for this tier — use cheapest overall
      if (providers.length > 0) {
        const cheapest = providers.reduce((min, p) =>
          p.inputPricePerMToken < min.inputPricePerMToken ? p : min
        , providers[0])
        const cost = estimateCost(cheapest, avgInputTokens, avgOutputTokens)
        blendedActual += cost.totalCostUsd * share
      }
    } else {
      const cheapest = tierProviders.reduce((min, p) =>
        p.inputPricePerMToken < min.inputPricePerMToken ? p : min
      , tierProviders[0])
      const cost = estimateCost(cheapest, avgInputTokens, avgOutputTokens)
      blendedActual += cost.totalCostUsd * share
    }
  }

  // Baseline: always use most expensive provider
  if (providers.length === 0) {
    return {
      monthlyRequestsEstimate: monthlyRequests,
      avgCostPerRequestActual: 0,
      avgCostPerRequestBaseline: 0,
      monthlyActualUsd: 0,
      monthlyBaselineUsd: 0,
      monthlySavingsUsd: 0,
      monthlySavingsPercent: 0,
      description: '0% savings — $0.00/mo saved (no providers configured)'
    }
  }

  const mostExpensive = providers.reduce((max, p) =>
    p.inputPricePerMToken > max.inputPricePerMToken ? p : max
  , providers[0])
  const baselineCost = estimateCost(mostExpensive, avgInputTokens, avgOutputTokens)

  const monthlyActualUsd = blendedActual * monthlyRequests
  const monthlyBaselineUsd = baselineCost.totalCostUsd * monthlyRequests
  const monthlySavingsUsd = Math.max(0, monthlyBaselineUsd - monthlyActualUsd)
  const monthlySavingsPercent = monthlyBaselineUsd > 0
    ? Math.round((monthlySavingsUsd / monthlyBaselineUsd) * 100)
    : 0

  return {
    monthlyRequestsEstimate: monthlyRequests,
    avgCostPerRequestActual: blendedActual,
    avgCostPerRequestBaseline: baselineCost.totalCostUsd,
    monthlyActualUsd,
    monthlyBaselineUsd,
    monthlySavingsUsd,
    monthlySavingsPercent,
    description: `${monthlySavingsPercent}% savings — $${monthlySavingsUsd.toFixed(2)}/mo saved vs always using ${mostExpensive.id}`
  }
}

// Routing overhead tracker — call this to record timing per phase
export class RoutingTimer {
  private start = Date.now()
  private marks: Record<string, number> = {}

  mark(phase: string): void {
    this.marks[phase] = Date.now() - this.start
  }

  getOverhead(): RoutingOverhead {
    const end = Date.now();
    return {
      taskClassificationMs: this.marks['task'] ?? 0,
      complexityScoringMs: (this.marks['complexity'] ?? 0) - (this.marks['task'] ?? 0),
      candidateSelectionMs: (this.marks['selection'] ?? 0) - (this.marks['complexity'] ?? 0),
      totalRoutingMs: end - this.start
    }
  }
}
