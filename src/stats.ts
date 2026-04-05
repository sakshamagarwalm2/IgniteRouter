/**
 * Usage Statistics Aggregator
 *
 * Reads usage log files and aggregates statistics for terminal display.
 * Supports filtering by date range and provides multiple aggregation views.
 */

import { readdir, unlink } from "node:fs/promises";
import { readTextFile } from "./fs-read.js";
import { join } from "node:path";
import { homedir } from "node:os";
import type { UsageEntry } from "./logger.js";
import { VERSION } from "./version.js";

const LOG_DIR = join(homedir(), ".openclaw", "igniterouter", "logs");

export type DailyStats = {
  date: string;
  totalRequests: number;
  avgLatencyMs: number;
  byTier: Record<string, { count: number }>;
  byModel: Record<string, { count: number }>;
};

export type AggregatedStats = {
  period: string;
  totalRequests: number;
  avgLatencyMs: number;
  avgLatencyPerRequest: number;
  byTier: Record<string, { count: number; percentage: number }>;
  byModel: Record<string, { count: number; percentage: number }>;
  dailyBreakdown: DailyStats[];
};

async function parseLogFile(filePath: string): Promise<UsageEntry[]> {
  try {
    const content = await readTextFile(filePath);
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: UsageEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Partial<UsageEntry>;
        entries.push({
          timestamp: entry.timestamp || new Date().toISOString(),
          model: entry.model || "unknown",
          tier: entry.tier || "UNKNOWN",
          cost: entry.cost || 0,
          baselineCost: entry.baselineCost || entry.cost || 0,
          savings: entry.savings || 0,
          latencyMs: entry.latencyMs || 0,
        });
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function getLogFiles(): Promise<string[]> {
  try {
    const files = await readdir(LOG_DIR);
    return files
      .filter((f) => f.startsWith("usage-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function aggregateDay(date: string, entries: UsageEntry[]): DailyStats {
  const byTier: Record<string, { count: number }> = {};
  const byModel: Record<string, { count: number }> = {};
  let totalLatency = 0;

  for (const entry of entries) {
    if (!byTier[entry.tier]) byTier[entry.tier] = { count: 0 };
    byTier[entry.tier].count++;

    if (!byModel[entry.model]) byModel[entry.model] = { count: 0 };
    byModel[entry.model].count++;

    totalLatency += entry.latencyMs;
  }

  return {
    date,
    totalRequests: entries.length,
    avgLatencyMs: entries.length > 0 ? totalLatency / entries.length : 0,
    byTier,
    byModel,
  };
}

export async function getStats(days: number = 7): Promise<AggregatedStats> {
  const logFiles = await getLogFiles();
  const filesToRead = logFiles.slice(0, days);

  const dailyBreakdown: DailyStats[] = [];
  const allByTier: Record<string, { count: number }> = {};
  const allByModel: Record<string, { count: number }> = {};
  let totalRequests = 0;
  let totalLatency = 0;

  for (const file of filesToRead) {
    const date = file.replace("usage-", "").replace(".jsonl", "");
    const filePath = join(LOG_DIR, file);
    const entries = await parseLogFile(filePath);

    if (entries.length === 0) continue;

    const dayStats = aggregateDay(date, entries);
    dailyBreakdown.push(dayStats);

    totalRequests += dayStats.totalRequests;
    totalLatency += dayStats.avgLatencyMs * dayStats.totalRequests;

    for (const [tier, stats] of Object.entries(dayStats.byTier)) {
      if (!allByTier[tier]) allByTier[tier] = { count: 0 };
      allByTier[tier].count += stats.count;
    }

    for (const [model, stats] of Object.entries(dayStats.byModel)) {
      if (!allByModel[model]) allByModel[model] = { count: 0 };
      allByModel[model].count += stats.count;
    }
  }

  const byTierWithPercentage: Record<string, { count: number; percentage: number }> = {};
  for (const [tier, stats] of Object.entries(allByTier)) {
    byTierWithPercentage[tier] = {
      ...stats,
      percentage: totalRequests > 0 ? (stats.count / totalRequests) * 100 : 0,
    };
  }

  const byModelWithPercentage: Record<string, { count: number; percentage: number }> = {};
  for (const [model, stats] of Object.entries(allByModel)) {
    byModelWithPercentage[model] = {
      ...stats,
      percentage: totalRequests > 0 ? (stats.count / totalRequests) * 100 : 0,
    };
  }

  return {
    period: days === 1 ? "today" : `last ${days} days`,
    totalRequests,
    avgLatencyMs: totalRequests > 0 ? totalLatency / totalRequests : 0,
    avgLatencyPerRequest: totalRequests > 0 ? totalLatency / totalRequests : 0,
    byTier: byTierWithPercentage,
    byModel: byModelWithPercentage,
    dailyBreakdown: dailyBreakdown.reverse(),
  };
}

export function formatStatsAscii(stats: AggregatedStats): string {
  const lines: string[] = [];

  lines.push("╔════════════════════════════════════════════════════════════╗");
  lines.push(`║          IgniteRouter v${VERSION}`.padEnd(61) + "║");
  lines.push("║                Usage Statistics                            ║");
  lines.push("╠════════════════════════════════════════════════════════════╣");

  lines.push(`║  Period: ${stats.period.padEnd(49)}║`);
  lines.push(`║  Total Requests: ${stats.totalRequests.toString().padEnd(41)}║`);
  lines.push(`║  Avg Latency: ${stats.avgLatencyMs.toFixed(0)}ms`.padEnd(61) + "║");

  const knownTiers = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING", "DIRECT"];
  const allTiers = Object.keys(stats.byTier);
  const tierOrder = [
    ...knownTiers.filter((t) => stats.byTier[t]),
    ...allTiers.filter((t) => !knownTiers.includes(t)),
  ];

  if (tierOrder.length > 0) {
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push("║  Routing by Tier:                                          ║");

    for (const tier of tierOrder) {
      const data = stats.byTier[tier];
      if (data) {
        const bar = "█".repeat(Math.min(20, Math.round(data.percentage / 5)));
        const displayTier = tier === "UNKNOWN" ? "OTHER" : tier;
        const line = `║    ${displayTier.padEnd(10)} ${bar.padEnd(20)} ${data.percentage.toFixed(1).padStart(5)}% (${data.count})`;
        lines.push(line.padEnd(61) + "║");
      }
    }
  }

  const sortedModels = Object.entries(stats.byModel)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  if (sortedModels.length > 0) {
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push("║  Top Models:                                               ║");

    for (const [model, data] of sortedModels) {
      const shortModel = model.length > 25 ? model.slice(0, 22) + "..." : model;
      const line = `║    ${shortModel.padEnd(25)} ${data.count.toString().padStart(5)} reqs`;
      lines.push(line.padEnd(61) + "║");
    }
  }

  if (stats.dailyBreakdown.length > 0) {
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push("║  Daily Breakdown:                                          ║");
    lines.push("║    Date        Requests    Latency                        ║");

    for (const day of stats.dailyBreakdown.slice(-7)) {
      const line = `║    ${day.date}   ${day.totalRequests.toString().padStart(6)}    ${day.avgLatencyMs.toFixed(0)}ms avg`;
      lines.push(line.padEnd(61) + "║");
    }
  }

  lines.push("╚════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}

export async function formatRecentLogs(days: number = 1): Promise<string> {
  const logFiles = await getLogFiles();
  const filesToRead = logFiles.slice(0, days);

  const allEntries: UsageEntry[] = [];
  for (const file of filesToRead) {
    const entries = await parseLogFile(join(LOG_DIR, file));
    allEntries.push(...entries);
  }

  allEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const lines: string[] = [];
  lines.push("╔════════════════════════════════════════════════════════════════════════╗");
  lines.push(
    `║  IgniteRouter Request Log — last ${days === 1 ? "24h" : `${days} days`}`.padEnd(72) + "║",
  );
  lines.push("╠══════════════════╦══════════════════════════╦═════════╦══════╦════════╣");
  lines.push("║  Time            ║  Model                   ║  Tier   ║  ms  ║ Status ║");
  lines.push("╠══════════════════╬══════════════════════════╬═════════╬══════╬════════╣");

  if (allEntries.length === 0) {
    lines.push("║  No requests found".padEnd(72) + "║");
  }

  for (const e of allEntries) {
    const time = e.timestamp.slice(11, 19);
    const date = e.timestamp.slice(5, 10);
    const displayTime = `${date} ${time}`;
    const model = e.model.length > 24 ? e.model.slice(0, 21) + "..." : e.model;
    const ms = e.latencyMs > 9999 ? `${(e.latencyMs / 1000).toFixed(1)}s` : `${e.latencyMs}ms`;
    const tier = e.tier.length > 7 ? e.tier.slice(0, 5) : e.tier;
    const status =
      (e as UsageEntry & { status?: string }).status === "error" ? " ERROR  " : " OK     ";
    lines.push(
      `║  ${displayTime.padEnd(16)}║  ${model.padEnd(24)}║  ${tier.padEnd(7)}║  ${ms.padStart(4)}║${status}║`,
    );
  }

  lines.push("╠══════════════════╩══════════════════════════╩═════════╩══════╩════════╣");
  lines.push(
    `║  ${allEntries.length} request${allEntries.length !== 1 ? "s" : ""}`.padEnd(72) + "║",
  );
  lines.push(
    "║  Logs: ~/.openclaw/igniterouter/logs/  (JSONL — one entry per request)".padEnd(72) + "║",
  );
  lines.push("╚════════════════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}

export async function clearStats(): Promise<{ deletedFiles: number }> {
  try {
    const files = await readdir(LOG_DIR);
    const logFiles = files.filter((f) => f.startsWith("usage-") && f.endsWith(".jsonl"));

    await Promise.all(logFiles.map((f) => unlink(join(LOG_DIR, f))));

    return { deletedFiles: logFiles.length };
  } catch {
    return { deletedFiles: 0 };
  }
}
