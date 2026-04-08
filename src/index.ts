/**
 * @igniterouter/igniterouter
 *
 * Smart LLM Router for OpenClaw — Decision-Only Mode
 *
 * This module provides intelligent routing decisions WITHOUT calling LLM.
 * OpenClaw calls the /v1/decide endpoint to get model recommendations,
 * then calls the LLM directly.
 *
 * Usage:
 *   # Install the plugin
 *   openclaw plugins install @igniterouter/igniterouter
 *
 *   # Use smart routing - OpenClaw will call /v1/decide before each request
 *   openclaw models set ignite/auto
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  PluginCommandContext,
  OpenClawPluginCommandDefinition,
} from "./types.js";
import {
  loadProvidersFromOpenClaw,
  createIgniteConfig,
  type IgniteConfig,
  type IgniteProvider,
  type ProviderPriority,
} from "./openclaw-providers.js";
import type { RoutingConfig } from "./router/index.js";
import { createDecideHandler, type DecideResponse } from "./decide-endpoint.js";
import { logger } from "./logger.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { VERSION } from "./version.js";

const log = logger.child("main");

let decideConfig: IgniteConfig | null = null;
let decideServer: ReturnType<typeof createServer> | null = null;
let decideServerPort = 8403;

function getDecidePort(): number {
  return decideServerPort;
}

async function startDecideServer(
  api: OpenClawPluginApi,
  igniteConfig: IgniteConfig,
): Promise<void> {
  decideConfig = igniteConfig;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check endpoint
      if (url === "/health" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            plugin: "igniterouter",
            version: VERSION,
            mode: "decision-only",
            providers: igniteConfig.providers.length,
          }),
        );
        return;
      }

      // Decision endpoint
      if (url === "/v1/decide" && method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const requestBody = JSON.parse(body);
          const decideHandler = createDecideHandler(igniteConfig);

          const decideReq = new Request("http://localhost/v1/decide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
          });

          const decideRes = await decideHandler(decideReq);
          const responseBody = await decideRes.text();

          res.writeHead(decideRes.status, { "Content-Type": "application/json" });
          res.end(responseBody);
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request", details: String(err) }));
        }
        return;
      }

      // Models list endpoint
      if (url === "/v1/models" && method === "GET") {
        const models = igniteConfig.providers.map((p) => ({
          id: p.id,
          object: "model",
          created: Date.now(),
          owned_by: p.providerName,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: models }));
        return;
      }

      // 404 for unknown endpoints
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.on("error", (err) => {
      log.error("Server error", { error: String(err) });
      reject(err);
    });

    server.listen(decideServerPort, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      decideServerPort = address.port;
      log.info("Decision server started", { port: decideServerPort });
      resolve();
    });
  });
}

function stopDecideServer(): Promise<void> {
  return new Promise((resolve) => {
    if (decideServer) {
      decideServer.close(() => {
        log.info("Decision server stopped");
        decideServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function createStatsCommand(): Promise<OpenClawPluginCommandDefinition> {
  return {
    name: "stats",
    description: "Show IgniteRouter usage statistics",
    acceptsArgs: false,
    requireAuth: false,
    handler: async () => {
      return {
        text: "IgniteRouter stats - Decision-only mode does not track usage stats yet.",
      };
    },
  };
}

async function createExcludeCommand(): Promise<OpenClawPluginCommandDefinition> {
  return {
    name: "exclude",
    description: "Exclude models from routing (not applicable in decision mode)",
    acceptsArgs: true,
    requireAuth: false,
    handler: async (_ctx: PluginCommandContext) => {
      return { text: "Exclusion not applicable in decision-only mode." };
    },
  };
}

function isGatewayMode(): boolean {
  return (
    process["env"].OPENCLAW_MODE === "gateway" || process["env"].IGNITEROUTER_MODE === "gateway"
  );
}

function isCompletionMode(): boolean {
  return process["env"].IGNITEROUTER_COMPLETION_ONLY === "true";
}

export const igniterouter: OpenClawPluginDefinition = {
  id: "igniterouter",
  name: "IgniteRouter",
  description: "Smart LLM router — Decision-only mode. Routes to cheapest capable model.",
  version: VERSION,

  register(api: OpenClawPluginApi) {
    const directConfig = api.pluginConfig as Record<string, any> | undefined;
    const nestedConfig =
      (api.pluginConfig?.igniterouter as Record<string, any>)?.config ||
      api.pluginConfig?.igniterouter;

    const finalConfig = nestedConfig || directConfig;
    const routingConfig = finalConfig?.routing as Partial<RoutingConfig> | undefined;
    const defaultPriority = (finalConfig?.defaultPriority || "cost") as ProviderPriority;

    api.logger.info("IgniteRouter starting in decision-only mode");

    // Load providers from OpenClaw config
    const openclawProviders = api.config.models?.providers as Record<string, any> | undefined;

    api.logger.info(
      `OpenClaw providers: ${openclawProviders ? Object.keys(openclawProviders).join(", ") : "none"}`,
    );

    const providers = loadProvidersFromOpenClaw(openclawProviders as any);

    if (providers.length === 0) {
      api.logger.warn("No providers loaded from OpenClaw config");
    } else {
      api.logger.info(`Loaded ${providers.length} providers from OpenClaw config`);

      // Log provider details
      for (const p of providers) {
        api.logger.info(
          `  - ${p.id}: tier=${p.tier}, tools=${p.supportsTools}, vision=${p.supportsVision}`,
        );
      }
    }

    const igniteConfig: IgniteConfig = createIgniteConfig(providers, defaultPriority);

    // Register models directly from config
    if (api.config.models?.providers) {
      // Use the already-loaded providers from OpenClaw config
      // Don't add them under "ignite" - just use as-is
    }

    // Register service for decide endpoint
    api.registerService({
      id: "igniterouter-decide",
      start: async () => {
        await startDecideServer(api, igniteConfig);
        api.logger.info(`IgniteRouter decision endpoint running on port ${getDecidePort()}`);
      },
      stop: async () => {
        await stopDecideServer();
        api.logger.info("IgniteRouter decision endpoint stopped");
      },
    });

    // Register commands
    createStatsCommand()
      .then((cmd) => api.registerCommand(cmd))
      .catch((err) => api.logger.warn(`Failed to register stats: ${err}`));

    createExcludeCommand()
      .then((cmd) => api.registerCommand(cmd))
      .catch((err) => api.logger.warn(`Failed to register exclude: ${err}`));

    // Check if we should start in gateway mode
    if (!isGatewayMode()) {
      api.logger.info("Not in gateway mode — decision server will start when gateway runs");
      return;
    }

    api.logger.info("Starting decision server in gateway mode...");

    startDecideServer(api, igniteConfig)
      .then(() => {
        api.logger.info(`IgniteRouter ready — decision endpoint on port ${getDecidePort()}`);
        api.logger.info(`Use: POST http://localhost:${getDecidePort()}/v1/decide`);
      })
      .catch((err) => {
        api.logger.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
      });
  },
};

export default igniterouter;

export { route } from "./routing-engine.js";
export type { RoutingContext, RoutingDecision } from "./routing-engine.js";
export type { IgniteConfig, IgniteProvider } from "./openclaw-providers.js";
export { loadProvidersFromOpenClaw, createIgniteConfig } from "./openclaw-providers.js";
