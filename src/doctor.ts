/**
 * IgniteRouter Doctor - AI-Powered Diagnostics
 *
 * Collects system diagnostics and sends to a model for analysis.
 */

import { platform, arch, freemem, totalmem } from "node:os";
import { getStats } from "./stats.js";
import { getProxyPort } from "./config.js";
import { VERSION } from "./version.js";

interface SystemInfo {
  os: string;
  arch: string;
  nodeVersion: string;
  memoryFree: string;
  memoryTotal: string;
}

interface NetworkInfo {
  localProxy: { running: boolean; port: number };
}

interface LogInfo {
  requestsLast24h: number;
}

interface DiagnosticResult {
  version: string;
  latestVersion: string | null;
  timestamp: string;
  system: SystemInfo;
  network: NetworkInfo;
  logs: LogInfo;
  issues: string[];
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)}GB`;
}

function green(text: string): string {
  return `\x1b[32m✓\x1b[0m ${text}`;
}

function red(text: string): string {
  return `\x1b[31m✗\x1b[0m ${text}`;
}

function yellow(text: string): string {
  return `\x1b[33m⚠\x1b[0m ${text}`;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/igniterouter/latest", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function collectSystemInfo(): SystemInfo {
  return {
    os: `${platform()} ${arch()}`,
    arch: arch(),
    nodeVersion: process.version,
    memoryFree: formatBytes(freemem()),
    memoryTotal: formatBytes(totalmem()),
  };
}

async function collectNetworkInfo(): Promise<NetworkInfo> {
  const port = getProxyPort();

  let proxyRunning = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    proxyRunning = response.ok;
  } catch {
    // proxyRunning already false
  }

  return {
    localProxy: { running: proxyRunning, port },
  };
}

async function collectLogInfo(): Promise<LogInfo> {
  try {
    const stats = await getStats(1);
    return {
      requestsLast24h: stats.totalRequests,
    };
  } catch {
    return {
      requestsLast24h: 0,
    };
  }
}

function identifyIssues(result: DiagnosticResult): string[] {
  const issues: string[] = [];

  if (!result.network.localProxy.running) {
    issues.push(`Local proxy not running on port ${result.network.localProxy.port}`);
  }
  if (result.latestVersion && result.latestVersion !== result.version) {
    issues.push(
      `Outdated version: running v${result.version}, latest is v${result.latestVersion}. Update recommended.`,
    );
  }

  return issues;
}

function printDiagnostics(result: DiagnosticResult): void {
  console.log("\n🔍 Collecting diagnostics...\n");

  console.log("Version");
  if (result.latestVersion && result.latestVersion !== result.version) {
    console.log(`  ${red(`Installed: v${result.version} (outdated!)`)}`);
    console.log(`  ${yellow(`Latest:    v${result.latestVersion}`)}`);
  } else if (result.latestVersion) {
    console.log(`  ${green(`v${result.version} (up to date)`)}`);
  } else {
    console.log(`  ${green(`v${result.version}`)}`);
  }

  console.log("\nSystem");
  console.log(`  ${green(`OS: ${result.system.os}`)}`);
  console.log(`  ${green(`Node: ${result.system.nodeVersion}`)}`);
  console.log(
    `  ${green(`Memory: ${result.system.memoryFree} free / ${result.system.memoryTotal}`)}`,
  );

  console.log("\nNetwork");
  if (result.network.localProxy.running) {
    console.log(`  ${green(`Local proxy: running on :${result.network.localProxy.port}`)}`);
  } else {
    console.log(`  ${red(`Local proxy: not running on :${result.network.localProxy.port}`)}`);
  }

  console.log("\nLogs");
  console.log(`  ${green(`Last 24h: ${result.logs.requestsLast24h} requests`)}`);

  if (result.issues.length > 0) {
    console.log("\n⚠️  Issues Found:");
    for (const issue of result.issues) {
      console.log(`  • ${issue}`);
    }
  }
}

type DoctorModel = "sonnet" | "opus";

const DOCTOR_MODELS: Record<DoctorModel, { id: string; name: string }> = {
  sonnet: {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
  },
  opus: {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
  },
};

async function analyzeWithAI(
  diagnostics: DiagnosticResult,
  userQuestion?: string,
  model: DoctorModel = "sonnet",
): Promise<void> {
  const modelConfig = DOCTOR_MODELS[model];
  console.log(`\n📤 Sending to ${modelConfig.name}...\n`);

  try {
    const port = getProxyPort();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelConfig.id,
        stream: false,
        messages: [
          {
            role: "system",
            content: `You are a technical support expert for IgniteRouter.
Analyze the diagnostics and:
1. Identify the root cause of any issues
2. Provide specific, actionable fix commands (bash)
3. Explain why the issue occurred briefly
4. Be concise but thorough
5. Format commands in code blocks`,
          },
          {
            role: "user",
            content: userQuestion
              ? `Here are my system diagnostics:\n\n${JSON.stringify(diagnostics, null, 2)}\n\nUser's question: ${userQuestion}`
              : `Here are my system diagnostics:\n\n${JSON.stringify(diagnostics, null, 2)}\n\nPlease analyze and help me fix any issues.`,
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.log(`Error: ${response.status} - ${text}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      console.log("🤖 AI Analysis:\n");
      console.log(content);
      console.log();
    } else {
      console.log("Error: No response from AI");
    }
  } catch (err) {
    console.log(`\nError calling AI: ${err instanceof Error ? err.message : String(err)}`);
    console.log("Make sure IgniteRouter proxy is running.\n");
  }
}

export async function runDoctor(
  userQuestion?: string,
  model: "sonnet" | "opus" = "sonnet",
): Promise<void> {
  console.log(`\n🩺 IgniteRouter Doctor v${VERSION}\n`);

  const [system, network, logs, latestVersion] = await Promise.all([
    collectSystemInfo(),
    collectNetworkInfo(),
    collectLogInfo(),
    fetchLatestVersion(),
  ]);

  const result: DiagnosticResult = {
    version: VERSION,
    latestVersion,
    timestamp: new Date().toISOString(),
    system,
    network,
    logs,
    issues: [],
  };

  result.issues = identifyIssues(result);

  printDiagnostics(result);

  await analyzeWithAI(result, userQuestion, model);
}
