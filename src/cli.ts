#!/usr/bin/env node
/**
 * IgniteRouter CLI
 *
 * Standalone proxy for deployed setups where the proxy needs to survive gateway restarts.
 *
 * Usage:
 *   npx igniterouter              # Start standalone proxy
 *   npx igniterouter --version    # Show version
 *   npx igniterouter --port 8402  # Custom port
 */

import { startProxy } from "./proxy.js";
import { VERSION } from "./version.js";
import { generateReport } from "./report.js";
import { formatRecentLogs } from "./stats.js";
import { runDoctor } from "./doctor.js";
import { PARTNER_SERVICES } from "./partners/index.js";
import { getProxyPort } from "./config.js";

function printHelp(): void {
  console.log(`
IgniteRouter v${VERSION} - Smart LLM Router

Usage:
  igniterouter [options]
  igniterouter status                # Live proxy status
  igniterouter models                # List available models
  igniterouter stats [--days <n>]    # Usage stats (default: 7 days)
  igniterouter doctor [opus] [question]
  igniterouter partners [test]
  igniterouter report [daily|weekly|monthly] [--json]
  igniterouter logs [--days <n>]

Options:
  --version, -v     Show version number
  --help, -h        Show this help message
  --port <number>   Port to listen on (default: ${getProxyPort()})

Query Commands (talk to running proxy on localhost:${getProxyPort()}):
  status            Proxy status
  models            List all available models
  stats             Usage breakdown: requests, top models
  stats --days 14   Custom time range (max 30 days)
  cache             Response cache stats (hit rate, size)

Management Commands:
  doctor            AI-powered diagnostics
  logs              Per-request breakdown: model, latency, status
  logs --days 7     Show last 7 days of requests (default: 1 day)
  partners          List available partner APIs

Environment Variables:
  IGNITEROUTER_PROXY_PORT     Default proxy port (default: 8402)
`);
}

async function queryProxy(path: string, port: number): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function cmdStatus(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/health", port)) as Record<string, unknown>;
    console.log(`\nIgniteRouter Status (port ${port})\n`);
    console.log(`  Status:        ${data.status}`);
    if (data.upstreamProxy) console.log(`  Upstream Proxy: ${data.upstreamProxy}`);
    console.log();
  } catch {
    console.error(`✗ Cannot connect to IgniteRouter on port ${port}`);
    console.error(`  Is the proxy running? Start with: npx igniterouter`);
    process.exit(1);
  }
}

async function cmdModels(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/v1/models", port)) as {
      data: Array<{ id: string }>;
    };
    console.log(`\nAvailable Models (${data.data.length})\n`);

    const groups = new Map<string, string[]>();
    for (const m of data.data) {
      const provider = m.id.includes("/") ? m.id.split("/")[0] : "igniterouter";
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(m.id);
    }

    for (const [provider, models] of groups) {
      console.log(`  ${provider} (${models.length}):`);
      for (const id of models) {
        console.log(`    ${id}`);
      }
      console.log();
    }
  } catch {
    console.error(`✗ Cannot connect to IgniteRouter on port ${port}`);
    process.exit(1);
  }
}

async function cmdStats(port: number, days: number): Promise<void> {
  try {
    const data = (await queryProxy(`/stats?days=${days}`, port)) as Record<string, unknown>;
    const stats = data as {
      totalRequests?: number;
      avgLatencyMs?: number;
      topModels?: Array<{ model: string; requests: number }>;
    };

    console.log(`\nUsage Stats (last ${days} days)\n`);
    console.log(`  Requests: ${stats.totalRequests ?? 0}`);
    console.log(`  Avg Latency: ${(stats.avgLatencyMs ?? 0).toFixed(0)}ms`);

    if (stats.topModels && stats.topModels.length > 0) {
      console.log();
      console.log(`  Top Models:`);
      for (const m of stats.topModels.slice(0, 10)) {
        console.log(`    ${m.model.padEnd(40)} ${String(m.requests).padStart(5)} reqs`);
      }
    }
    console.log();
  } catch {
    console.error(`✗ Cannot connect to IgniteRouter on port ${port}`);
    process.exit(1);
  }
}

async function cmdCache(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/cache", port)) as Record<string, unknown>;
    console.log(`\nCache Stats\n`);
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
    console.log();
  } catch {
    console.error(`✗ Cannot connect to IgniteRouter on port ${port}`);
    process.exit(1);
  }
}

function parseArgs(args: string[]): {
  version: boolean;
  help: boolean;
  doctor: boolean;
  logs: boolean;
  logsDays: number;
  partners: boolean;
  partnersTest: boolean;
  report: boolean;
  reportPeriod: "daily" | "weekly" | "monthly";
  reportJson: boolean;
  port?: number;
  queryStatus: boolean;
  queryModels: boolean;
  queryStats: boolean;
  queryStatsDays: number;
  queryCache: boolean;
} {
  const result = {
    version: false,
    help: false,
    doctor: false,
    logs: false,
    logsDays: 1,
    partners: false,
    partnersTest: false,
    report: false,
    reportPeriod: "daily" as "daily" | "weekly" | "monthly",
    reportJson: false,
    port: undefined as number | undefined,
    queryStatus: false,
    queryModels: false,
    queryStats: false,
    queryStatsDays: 7,
    queryCache: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "status") {
      result.queryStatus = true;
    } else if (arg === "models") {
      result.queryModels = true;
    } else if (arg === "stats") {
      result.queryStats = true;
      if (args[i + 1] === "--days" && args[i + 2]) {
        result.queryStatsDays = Math.min(parseInt(args[i + 2], 10) || 7, 30);
        i += 2;
      }
    } else if (arg === "cache") {
      result.queryCache = true;
    } else if (arg === "doctor" || arg === "--doctor") {
      result.doctor = true;
    } else if (arg === "logs") {
      result.logs = true;
      if (args[i + 1] === "--days" && args[i + 2]) {
        result.logsDays = parseInt(args[i + 2], 10) || 1;
        i += 2;
      }
    } else if (arg === "partners") {
      result.partners = true;
      if (args[i + 1] === "test") {
        result.partnersTest = true;
        i++;
      }
    } else if (arg === "report") {
      result.report = true;
      const next = args[i + 1];
      if (next && ["daily", "weekly", "monthly"].includes(next)) {
        result.reportPeriod = next as "daily" | "weekly" | "monthly";
        i++;
        if (args[i + 1] === "--json") {
          result.reportJson = true;
          i++;
        }
      } else if (next === "--json") {
        result.reportJson = true;
        i++;
      }
    } else if (arg === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const queryPort = args.port ?? getProxyPort();

  if (args.queryStatus) {
    await cmdStatus(queryPort);
    process.exit(0);
  }
  if (args.queryModels) {
    await cmdModels(queryPort);
    process.exit(0);
  }
  if (args.queryStats) {
    await cmdStats(queryPort, args.queryStatsDays);
    process.exit(0);
  }
  if (args.queryCache) {
    await cmdCache(queryPort);
    process.exit(0);
  }

  if (args.doctor) {
    const rawArgs = process.argv.slice(2);
    const doctorIndex = rawArgs.findIndex((a) => a === "doctor" || a === "--doctor");
    const afterDoctor = rawArgs.slice(doctorIndex + 1);

    let model: "sonnet" | "opus" = "sonnet";
    let questionArgs = afterDoctor;

    if (afterDoctor[0] === "opus") {
      model = "opus";
      questionArgs = afterDoctor.slice(1);
    } else if (afterDoctor[0] === "sonnet") {
      model = "sonnet";
      questionArgs = afterDoctor.slice(1);
    }

    const userQuestion = questionArgs.join(" ").trim() || undefined;
    await runDoctor(userQuestion, model);
    process.exit(0);
  }

  if (args.logs) {
    const output = await formatRecentLogs(args.logsDays);
    console.log(output);
    process.exit(0);
  }

  if (args.partners) {
    if (PARTNER_SERVICES.length === 0) {
      console.log("No partner APIs available.");
      process.exit(0);
    }

    console.log(`\nIgniteRouter Partner APIs (v${VERSION})\n`);

    for (const svc of PARTNER_SERVICES) {
      console.log(`  ${svc.name} (${svc.partner})`);
      console.log(`    ${svc.description}`);
      console.log(`    Tool:    igniterouter_${svc.id}`);
      console.log(`    Method:  ${svc.method} /v1${svc.proxyPath}`);
      console.log();
    }

    if (args.partnersTest) {
      console.log("Testing partner endpoints...\n");
      for (const svc of PARTNER_SERVICES) {
        try {
          console.log(`  ${svc.id}: (partner endpoints require authentication)`);
        } catch (err) {
          console.log(`  ${svc.id}: error - ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      console.log();
    }

    process.exit(0);
  }

  if (args.report) {
    const report = await generateReport(args.reportPeriod, args.reportJson);
    console.log(report);
    process.exit(0);
  }

  const proxy = await startProxy({
    port: args.port,
    onReady: (port) => {
      console.log(`[IgniteRouter] v${VERSION} | Proxy listening on http://127.0.0.1:${port}`);
      console.log(`[IgniteRouter] Health check: http://127.0.0.1:${port}/health`);
    },
    onError: (error) => {
      console.error(`[IgniteRouter] Error: ${error.message}`);
    },
  });

  console.log(`[IgniteRouter] Ready - Ctrl+C to stop`);

  const shutdown = async (signal: string) => {
    console.log(`\n[IgniteRouter] Received ${signal}, shutting down...`);
    try {
      await proxy.close();
      console.log(`[IgniteRouter] Proxy closed`);
      process.exit(0);
    } catch (err) {
      console.error(`[IgniteRouter] Error during shutdown: ${err}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`[IgniteRouter] Fatal error: ${err.message}`);
  console.error(`[IgniteRouter] Need help? Run: npx igniterouter doctor`);
  process.exit(1);
});
