/**
 * @igniterouter/igniterouter
 *
 * Smart LLM router for OpenClaw — 55+ models, intelligent routing, 78% cost savings.
 * Routes each request to the cheapest model that can handle it.
 *
 * Usage:
 *   # Install the plugin
 *   openclaw plugins install @igniterouter/igniterouter
 *
 *   # Use smart routing (auto-picks cheapest model)
 *   openclaw models set ignite/auto
 *
 *   # Or use any specific model
 *   openclaw models set openai/gpt-5.3
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  PluginCommandContext,
  OpenClawPluginCommandDefinition,
} from "./types.js";
import { igniteProvider, setActiveProxy } from "./provider.js";
import { startProxy, getProxyPort } from "./proxy.js";
import {
  loadProviders,
  type IgniteConfig,
  type ProviderPriority,
  type UserProvider,
} from "./user-providers.js";
import type { RoutingConfig } from "./router/index.js";
import {
  loadExcludeList,
  addExclusion,
  removeExclusion,
  clearExclusions,
} from "./exclude-models.js";

async function waitForProxyHealth(port: number, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // Proxy not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
import { OPENCLAW_MODELS } from "./models.js";
import {
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { readTextFileSync } from "./fs-read.js";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";
import { getStats, formatStatsAscii, clearStats } from "./stats.js";
import { buildPartnerTools, PARTNER_SERVICES } from "./partners/index.js";

function writeDebug(msg: string) {
  try {
    writeFileSync("/tmp/ignite-debug.log", `${new Date().toISOString()} ${msg}\n`, { flag: "a" });
  } catch {}
}

function installSkillsToWorkspace(logger: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}) {
  try {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const bundledSkillsDir = join(packageRoot, "skills");

    if (!existsSync(bundledSkillsDir)) {
      return;
    }

    const profile = (process["env"].OPENCLAW_PROFILE ?? "").trim().toLowerCase();
    const workspaceDirName =
      profile && profile !== "default" ? `workspace-${profile}` : "workspace";
    const workspaceSkillsDir = join(homedir(), ".openclaw", workspaceDirName, "skills");
    mkdirSync(workspaceSkillsDir, { recursive: true });

    const INTERNAL_SKILLS = new Set(["release"]);
    const entries = readdirSync(bundledSkillsDir, { withFileTypes: true });
    let installed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      if (INTERNAL_SKILLS.has(skillName)) continue;
      const srcSkillFile = join(bundledSkillsDir, skillName, "SKILL.md");
      if (!existsSync(srcSkillFile)) continue;

      const destDir = join(workspaceSkillsDir, skillName);
      const destSkillFile = join(destDir, "SKILL.md");

      let needsUpdate = true;
      if (existsSync(destSkillFile)) {
        try {
          const srcContent = readTextFileSync(srcSkillFile);
          const destContent = readTextFileSync(destSkillFile);
          if (srcContent === destContent) needsUpdate = false;
        } catch {
          // Can't read — overwrite
        }
      }

      if (needsUpdate) {
        mkdirSync(destDir, { recursive: true });
        copyFileSync(srcSkillFile, destSkillFile);
        installed++;
      }
    }

    if (installed > 0) {
      logger.info(`Installed ${installed} skill(s) to ${workspaceSkillsDir}`);
    }
  } catch (err) {
    logger.warn(`Failed to install skills: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isCompletionMode(): boolean {
  const args = process.argv;
  return args.some((arg, i) => arg === "completion" && i >= 1 && i <= 3);
}

function isGatewayMode(): boolean {
  const args = process.argv;
  const env = process.env;
  return (
    args.includes("gateway") || env.OPENCLAW_GATEWAY === "true" || env.OPENCLAW_MODE === "gateway"
  );
}

function injectModelsConfig(logger: { info: (msg: string) => void }): void {
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");

  let config: Record<string, unknown> = {};
  let needsWrite = false;

  if (!existsSync(configDir)) {
    try {
      mkdirSync(configDir, { recursive: true });
      logger.info("Created OpenClaw config directory");
    } catch (err) {
      logger.info(
        `Failed to create config dir: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  if (existsSync(configPath)) {
    try {
      const content = readTextFileSync(configPath).trim();
      if (content) {
        config = JSON.parse(content);
      } else {
        logger.info("OpenClaw config is empty, initializing");
        needsWrite = true;
      }
    } catch (err) {
      const backupPath = `${configPath}.backup.${Date.now()}`;
      try {
        copyFileSync(configPath, backupPath);
        logger.info(`Config parse failed, backed up to ${backupPath}`);
      } catch {
        logger.info("Config parse failed, could not create backup");
      }
      logger.info(
        `Skipping config injection (corrupt file): ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  } else {
    logger.info("OpenClaw config not found, creating");
    needsWrite = true;
  }

  if (!config.models) {
    config.models = {};
    needsWrite = true;
  }
  const models = config.models as Record<string, unknown>;
  if (!models.providers) {
    models.providers = {};
    needsWrite = true;
  }

  const proxyPort = getProxyPort();
  const expectedBaseUrl = `http://127.0.0.1:${proxyPort}/v1`;

  const providers = models.providers as Record<string, unknown>;

  if (!providers.ignite) {
    providers.ignite = {
      baseUrl: expectedBaseUrl,
      api: "openai-completions",
      apiKey: "ignite-proxy",
      models: OPENCLAW_MODELS,
    };
    logger.info("Injected IgniteRouter provider config");
    needsWrite = true;
  } else {
    const ignite = providers.ignite as Record<string, unknown>;
    let fixed = false;

    if (!ignite.baseUrl || ignite.baseUrl !== expectedBaseUrl) {
      ignite.baseUrl = expectedBaseUrl;
      fixed = true;
    }
    if (!ignite.api) {
      ignite.api = "openai-completions";
      fixed = true;
    }
    if (!ignite.apiKey) {
      ignite.apiKey = "ignite-proxy";
      fixed = true;
    }
    const currentModels = ignite.models as Array<{ id?: string }>;
    const currentModelIds = new Set(
      Array.isArray(currentModels) ? currentModels.map((m) => m?.id).filter(Boolean) : [],
    );
    const expectedModelIds = OPENCLAW_MODELS.map((m) => m.id);
    const needsModelUpdate =
      !currentModels ||
      !Array.isArray(currentModels) ||
      currentModels.length !== OPENCLAW_MODELS.length ||
      expectedModelIds.some((id) => !currentModelIds.has(id));

    if (needsModelUpdate) {
      ignite.models = OPENCLAW_MODELS;
      fixed = true;
      logger.info(`Updated models list (${OPENCLAW_MODELS.length} models)`);
    }

    if (fixed) {
      logger.info("Fixed incomplete IgniteRouter provider config");
      needsWrite = true;
    }
  }

  if (!config.agents) {
    config.agents = {};
    needsWrite = true;
  }
  const agents = config.agents as Record<string, unknown>;
  if (!agents.defaults) {
    agents.defaults = {};
    needsWrite = true;
  }
  const defaults = agents.defaults as Record<string, unknown>;
  if (!defaults.model || typeof defaults.model !== "object" || Array.isArray(defaults.model)) {
    const prev = typeof defaults.model === "string" ? defaults.model : undefined;
    defaults.model = prev ? { primary: prev } : {};
    needsWrite = true;
  }
  const model = defaults.model as Record<string, unknown>;

  if (!model.primary) {
    model.primary = "ignite/auto";
    logger.info("Set default model to ignite/auto (first install)");
    needsWrite = true;
  }

  const TOP_MODELS = [
    "auto",
    "free",
    "eco",
    "premium",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.6",
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5.4",
    "openai/gpt-5.3",
    "openai/gpt-5.3-codex",
    "openai/gpt-4o",
    "openai/o3",
    "google/gemini-3.1-pro",
    "google/gemini-3-flash-preview",
    "deepseek/deepseek-chat",
    "moonshot/kimi-k2.5",
    "xai/grok-3",
    "minimax/minimax-m2.5",
    "free/gpt-oss-120b",
    "free/gpt-oss-20b",
    "free/nemotron-ultra-253b",
    "free/deepseek-v3.2",
    "free/mistral-large-3-675b",
    "free/qwen3-coder-480b",
    "free/devstral-2-123b",
    "free/llama-4-maverick",
    "free/nemotron-3-super-120b",
    "free/nemotron-super-49b",
    "free/glm-4.7",
  ];
  if (!defaults.models || typeof defaults.models !== "object" || Array.isArray(defaults.models)) {
    defaults.models = {};
    needsWrite = true;
  }
  const allowlist = defaults.models as Record<string, unknown>;
  const DEPRECATED_MODELS = ["ignite/xai/grok-code-fast-1"];
  let removedDeprecatedCount = 0;
  for (const key of DEPRECATED_MODELS) {
    if (allowlist[key]) {
      delete allowlist[key];
      removedDeprecatedCount++;
    }
  }
  if (removedDeprecatedCount > 0) {
    needsWrite = true;
    logger.info(`Removed ${removedDeprecatedCount} deprecated model entries from allowlist`);
  }
  let addedCount = 0;
  for (const id of TOP_MODELS) {
    const key = `ignite/${id}`;
    if (!allowlist[key]) {
      allowlist[key] = {};
      addedCount++;
    }
  }
  if (addedCount > 0) {
    needsWrite = true;
    logger.info(`Added ${addedCount} models to allowlist (${TOP_MODELS.length} total)`);
  }

  if (needsWrite) {
    try {
      const tmpPath = `${configPath}.tmp.${process.pid}`;
      writeFileSync(tmpPath, JSON.stringify(config, null, 2));
      renameSync(tmpPath, configPath);
      logger.info("Smart routing enabled (ignite/auto)");
    } catch (err) {
      logger.info(`Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function injectAuthProfile(logger: { info: (msg: string) => void }): void {
  const agentsDir = join(homedir(), ".openclaw", "agents");

  if (!existsSync(agentsDir)) {
    try {
      mkdirSync(agentsDir, { recursive: true });
    } catch (err) {
      logger.info(
        `Could not create agents dir: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  try {
    let agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    if (!agents.includes("main")) {
      agents = ["main", ...agents];
    }

    for (const agentId of agents) {
      const authDir = join(agentsDir, agentId, "agent");
      const authPath = join(authDir, "auth-profiles.json");

      if (!existsSync(authDir)) {
        try {
          mkdirSync(authDir, { recursive: true });
        } catch {
          continue;
        }
      }

      let store: { version: number; profiles: Record<string, unknown> } = {
        version: 1,
        profiles: {},
      };
      if (existsSync(authPath)) {
        try {
          const existing = JSON.parse(readTextFileSync(authPath));
          if (existing.version && existing.profiles) {
            store = existing;
          }
        } catch {
          // Invalid JSON, use fresh store
        }
      }

      const profileKey = "ignite:default";
      if (store.profiles[profileKey]) {
        continue;
      }

      store.profiles[profileKey] = {
        type: "api_key",
        provider: "ignite",
        key: "ignite-proxy",
      };

      try {
        writeFileSync(authPath, JSON.stringify(store, null, 2));
        logger.info(`Injected IgniteRouter auth profile for agent: ${agentId}`);
      } catch (err) {
        logger.info(
          `Could not inject auth for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    logger.info(`Auth injection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let activeProxyHandle: Awaited<ReturnType<typeof startProxy>> | null = null;

async function startProxyInBackground(api: OpenClawPluginApi): Promise<void> {
  const configJson = JSON.stringify(api.pluginConfig);
  api.logger.info(`DEBUG: pluginConfig = ${configJson}`);

  // OpenClaw plugin config can be flat or nested under plugin ID
  const directConfig = api.pluginConfig as Record<string, any> | undefined;
  const nestedConfig = (api.pluginConfig?.igniterouter as Record<string, any>)?.config || api.pluginConfig?.igniterouter;
  
  const finalConfig = nestedConfig || directConfig;

  const routingConfig = finalConfig?.routing as Partial<RoutingConfig> | undefined;
  let rawProviders = finalConfig?.providers as unknown[] | undefined;

  api.logger.info(
    `DEBUG: rawProviders = ${rawProviders ? JSON.stringify(rawProviders).substring(0, 100) + "..." : "undefined"}`,
  );
  
  const igniteConfig: IgniteConfig | undefined =
    rawProviders && rawProviders.length > 0
      ? {
          defaultPriority: (finalConfig?.defaultPriority || "cost") as ProviderPriority,
          providers: rawProviders as unknown as UserProvider[],
        }
      : undefined;

  if (activeProxyHandle && !igniteConfig?.providers?.length) {
    api.logger.info("Proxy already running without new providers, reusing existing instance");
    setActiveProxy(activeProxyHandle);
    api.logger.info(`IgniteRouter ready — smart routing enabled`);
    return;
  }

  if (activeProxyHandle) {
    api.logger.info("Closing existing proxy to restart with new providers");
    try {
      await activeProxyHandle.close();
    } catch (e) {
      api.logger.warn(`Error closing proxy: ${e}`);
    }
    activeProxyHandle = null;
  }

  const proxy = await startProxy({
    routingConfig,
    igniteConfig,
    onReady: (port) => {
      api.logger.info(`IgniteRouter proxy listening on port ${port}`);
    },
    onError: (error) => {
      api.logger.error(`IgniteRouter proxy error: ${error.message}`);
    },
    onRouted: (decision) => {
      const cost = decision.costEstimate.toFixed(4);
      const saved = (decision.savings * 100).toFixed(0);
      api.logger.info(
        `[${decision.tier}] ${decision.model} $${cost} (saved ${saved}%) | ${decision.reasoning}`,
      );
    },
  });

  setActiveProxy(proxy);
  activeProxyHandle = proxy;

  const startupExclusions = loadExcludeList();
  if (startupExclusions.size > 0) {
    api.logger.info(
      `Model exclusions active (${startupExclusions.size}): ${[...startupExclusions].join(", ")}`,
    );
  }

  api.logger.info(`IgniteRouter ready — smart routing enabled`);
}

async function createStatsCommand(): Promise<OpenClawPluginCommandDefinition> {
  return {
    name: "stats",
    description: "Show IgniteRouter usage statistics",
    acceptsArgs: true,
    requireAuth: false,
    handler: async (ctx: PluginCommandContext) => {
      const arg = ctx.args?.trim().toLowerCase() || "7";

      if (arg === "clear" || arg === "reset") {
        try {
          const { deletedFiles } = await clearStats();
          return {
            text: `Stats cleared — ${deletedFiles} log file(s) deleted.`,
          };
        } catch (err) {
          return {
            text: `Failed to clear stats: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      }

      const days = parseInt(arg, 10) || 7;

      try {
        const stats = await getStats(Math.min(days, 30));
        const ascii = formatStatsAscii(stats);

        return {
          text: ["```", ascii, "```"].join("\n"),
        };
      } catch (err) {
        return {
          text: `Failed to load stats: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

async function createExcludeCommand(): Promise<OpenClawPluginCommandDefinition> {
  return {
    name: "exclude",
    description: "Manage excluded models — /exclude add|remove|clear <model>",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      const args = ctx.args?.trim() || "";
      const parts = args.split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || "";
      const modelArg = parts.slice(1).join(" ").trim();

      if (!subcommand) {
        const list = loadExcludeList();
        if (list.size === 0) {
          return {
            text: "No models excluded.\n\nUsage:\n  /exclude add <model>  — block a model\n  /exclude remove <model> — unblock\n  /exclude clear — remove all",
          };
        }
        const models = [...list]
          .sort()
          .map((m) => `  • ${m}`)
          .join("\n");
        return {
          text: `Excluded models (${list.size}):\n${models}\n\nUse /exclude remove <model> to unblock.`,
        };
      }

      if (subcommand === "add") {
        if (!modelArg) {
          return {
            text: "Usage: /exclude add <model>\nExample: /exclude add nvidia/gpt-oss-120b",
            isError: true,
          };
        }
        const resolved = addExclusion(modelArg);
        const list = loadExcludeList();
        return {
          text: `Excluded: ${resolved}\n\nActive exclusions (${list.size}):\n${[...list]
            .sort()
            .map((m) => `  • ${m}`)
            .join("\n")}`,
        };
      }

      if (subcommand === "remove") {
        if (!modelArg) {
          return { text: "Usage: /exclude remove <model>", isError: true };
        }
        const removed = removeExclusion(modelArg);
        if (!removed) {
          return { text: `Model "${modelArg}" was not in the exclude list.` };
        }
        const list = loadExcludeList();
        return {
          text: `Unblocked: ${modelArg}\n\nActive exclusions (${list.size}):\n${
            list.size > 0
              ? [...list]
                  .sort()
                  .map((m) => `  • ${m}`)
                  .join("\n")
              : "  (none)"
          }`,
        };
      }

      if (subcommand === "clear") {
        clearExclusions();
        return { text: "All model exclusions cleared." };
      }

      return {
        text: `Unknown subcommand: ${subcommand}\n\nUsage:\n  /exclude — show list\n  /exclude add <model>\n  /exclude remove <model>\n  /exclude clear`,
        isError: true,
      };
    },
  };
}

const plugin: OpenClawPluginDefinition = {
  id: "igniterouter",
  name: "IgniteRouter",
  description: "Smart LLM router — 55+ models, intelligent routing, 78% cost savings",
  version: VERSION,

  register(api: OpenClawPluginApi) {
    writeDebug(`register called: pluginConfig = ${JSON.stringify(api.pluginConfig)}`);
    api.logger.info(
      `=== DEBUG: pluginConfig keys = ${Object.keys(api.pluginConfig || {}).join(", ")}`,
    );
    api.logger.info(`=== DEBUG: full pluginConfig = ${JSON.stringify(api.pluginConfig)}`);

    const isDisabled =
      process["env"].IGNITEROUTER_DISABLED === "true" ||
      process["env"].IGNITEROUTER_DISABLED === "1";
    if (isDisabled) {
      api.logger.info("IgniteRouter disabled (IGNITEROUTER_DISABLED=true). Using default routing.");
      return;
    }

    installSkillsToWorkspace(api.logger);

    if (isCompletionMode()) {
      api.registerProvider(igniteProvider);
      return;
    }

    api.registerProvider(igniteProvider);

    injectModelsConfig(api.logger);
    injectAuthProfile(api.logger);

    const runtimePort = getProxyPort();
    if (!api.config.models) {
      api.config.models = { providers: {} };
    }
    if (!api.config.models.providers) {
      api.config.models.providers = {};
    }
    api.config.models.providers.ignite = {
      baseUrl: `http://127.0.0.1:${runtimePort}/v1`,
      api: "openai-completions",
      apiKey: "ignite-proxy",
      models: OPENCLAW_MODELS,
    };

    api.logger.info("IgniteRouter provider registered (55+ models)");

    try {
      const proxyBaseUrl = `http://127.0.0.1:${runtimePort}`;
      const partnerTools = buildPartnerTools(proxyBaseUrl);
      for (const tool of partnerTools) {
        api.registerTool(tool);
      }
      if (partnerTools.length > 0) {
        api.logger.info(
          `Registered ${partnerTools.length} partner tool(s): ${partnerTools.map((t) => t.name).join(", ")}`,
        );
      }

      api.registerCommand({
        name: "partners",
        description: "List available partner APIs and pricing",
        acceptsArgs: false,
        requireAuth: false,
        handler: async () => {
          if (PARTNER_SERVICES.length === 0) {
            return { text: "No partner APIs available." };
          }

          const lines = ["**Partner APIs**", ""];

          for (const svc of PARTNER_SERVICES) {
            lines.push(`**${svc.name}** (${svc.partner})`);
            lines.push(`  ${svc.description}`);
            lines.push(`  Tool: \`${`ignite_${svc.id}`}\``);
            lines.push(
              `  Pricing: ${svc.pricing.perUnit} per ${svc.pricing.unit} (min ${svc.pricing.minimum}, max ${svc.pricing.maximum})`,
            );
            lines.push(
              `  **How to use:** Ask "Look up Twitter user @elonmusk" or "Get info on these X accounts: @naval, @balajis"`,
            );
            lines.push("");
          }

          return { text: lines.join("\n") };
        },
      });
    } catch (err) {
      api.logger.warn(
        `Failed to register partner tools: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    createStatsCommand()
      .then((statsCommand) => {
        api.registerCommand(statsCommand);
      })
      .catch((err) => {
        api.logger.warn(
          `Failed to register /stats command: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    createExcludeCommand()
      .then((excludeCommand) => {
        api.registerCommand(excludeCommand);
      })
      .catch((err) => {
        api.logger.warn(
          `Failed to register /exclude command: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    api.registerService({
      id: "igniterouter-proxy",
      start: () => {},
      stop: async () => {
        if (activeProxyHandle) {
          try {
            await activeProxyHandle.close();
            api.logger.info("IgniteRouter proxy closed");
          } catch (err) {
            api.logger.warn(
              `Failed to close proxy: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          activeProxyHandle = null;
        }
      },
    });

    if (!isGatewayMode()) {
      api.logger.info("Not in gateway mode — proxy will start when gateway runs");
      return;
    }

    api.logger.info("Starting proxy in gateway mode...");
    startProxyInBackground(api)
      .then(async () => {
        const port = getProxyPort();
        const healthy = await waitForProxyHealth(port, 5000);
        if (!healthy) {
          api.logger.warn(`Proxy health check timed out, commands may not work immediately`);
        }
      })
      .catch((err) => {
        api.logger.error(
          `Failed to start IgniteRouter proxy: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  },
};

export default plugin;

export { startProxy, getProxyPort } from "./proxy.js";
export type { ProxyOptions, ProxyHandle } from "./proxy.js";
export { igniteProvider } from "./provider.js";
export { loadProviders } from "./user-providers.js";
export {
  OPENCLAW_MODELS,
  IgniteRouter_MODELS,
  buildProviderModels,
  MODEL_ALIASES,
  resolveModelAlias,
  isAgenticModel,
  getAgenticModels,
  getModelContextWindow,
} from "./models.js";
export {
  route,
  DEFAULT_ROUTING_CONFIG,
  getFallbackChain,
  getFallbackChainFiltered,
  calculateModelCost,
  classifyByRules,
} from "./router/index.js";
export type { RoutingDecision, RoutingConfig, Tier } from "./router/index.js";
export { TaskType, classifyTask } from "./task-classifier.js";
export { logUsage } from "./logger.js";
export type { UsageEntry } from "./logger.js";
export { RequestDeduplicator } from "./dedup.js";
export type { CachedResponse } from "./dedup.js";
export { fetchWithRetry, isRetryable, DEFAULT_RETRY_CONFIG } from "./retry.js";
export type { RetryConfig } from "./retry.js";
export { getStats, formatStatsAscii, clearStats } from "./stats.js";
export type { DailyStats, AggregatedStats } from "./stats.js";
export {
  SessionStore,
  getSessionId,
  hashRequestContent,
  DEFAULT_SESSION_CONFIG,
} from "./session.js";
export type { SessionEntry, SessionConfig } from "./session.js";
export { ResponseCache } from "./response-cache.js";
export type { CachedLLMResponse, ResponseCacheConfig } from "./response-cache.js";
export { PARTNER_SERVICES, getPartnerService, buildPartnerTools } from "./partners/index.js";
export type { PartnerServiceDefinition, PartnerToolDefinition } from "./partners/index.js";
export {
  buildUpstreamRequest,
  getProviderBaseUrl,
  getProviderAuthHeaders,
} from "./provider-url-builder.js";
