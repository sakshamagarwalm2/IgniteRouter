/**
 * IgniteRouter ProviderPlugin for OpenClaw
 *
 * Registers IgniteRouter as an LLM provider in OpenClaw.
 * Uses a local proxy to handle requests transparently —
 * pi-ai sees a standard OpenAI-compatible API at localhost.
 */

import type { ProviderPlugin } from "./types.js";
import { buildProviderModels } from "./models.js";
import type { ProxyHandle } from "./proxy.js";

let activeProxy: ProxyHandle | null = null;

export function setActiveProxy(proxy: ProxyHandle): void {
  activeProxy = proxy;
}

export function getActiveProxy(): ProxyHandle | null {
  return activeProxy;
}

export const igniteProvider: ProviderPlugin = {
  id: "igniterouter",
  label: "IgniteRouter",
  docsPath: "https://github.com/IgniteRouter/IgniteRouter",
  aliases: ["ir"],
  envVars: [],

  get models() {
    if (!activeProxy) {
      return buildProviderModels("http://127.0.0.1:8402");
    }
    return buildProviderModels(activeProxy.baseUrl);
  },

  auth: [],
};
