import { startProxy } from "./dist/index.js";
import { loadProviders } from "./dist/index.js";

const config = loadProviders({
  defaultPriority: "quality",
  providers: [
    { id: "deepseek/deepseek-chat", apiKey: "sk-9fc5d1f084eb43fe838689f57c031ba4", tier: "SIMPLE" },
    {
      id: "deepseek/deepseek-reasoner",
      apiKey: "sk-9fc5d1f084eb43fe838689f57c031ba4",
      tier: "MEDIUM",
    },
    {
      id: "mistral/mistral-large-latest",
      apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v",
      tier: "COMPLEX",
    },
    {
      id: "xiaomi/mimo-v2-flash",
      apiKey: "sk-sj02d4aig8ho34x2y0tkbj9g60hlziv8q2c8hmtbld7gj7lz",
      tier: "SIMPLE",
    },
    {
      id: "openrouter/auto",
      apiKey: "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",
      tier: "MEDIUM",
    },
  ],
});

console.log(
  "Loaded providers:",
  config.providers.map((p) => p.id),
);
console.log("Default priority:", config.defaultPriority);

const proxy = await startProxy({
  port: 8402,
  igniteConfig: config,
  onReady: (port) => console.log("✅ Proxy running on port", port),
  onRouted: (d) => console.log("📡 Routed:", d.model, "| Tier:", d.tier, "| Task:", d.taskType),
});

console.log("Ready - use /priority to change mode");
