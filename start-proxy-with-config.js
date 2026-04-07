import { startProxy } from "./dist/index.js";
import { loadProviders } from "./dist/index.js";

const config = loadProviders({
  defaultPriority: "cost",
  providers: [
    { id: "deepseek/deepseek-chat", apiKey: "sk-9fc5d1f084eb43fe838689f57c031ba4", tier: "SIMPLE" },
    { id: "deepseek/deepseek-reasoner", apiKey: "sk-9fc5d1f084eb43fe838689f57c031ba4", tier: "MEDIUM" },
    { id: "mistral/mistral-large-latest", apiKey: "wQ989AzrDfURKtFub7BE6jFiCdkMqN8v", tier: "COMPLEX" },
    { id: "xiaomi/mimo-v2-flash", apiKey: "sk-sj02d4aig8ho34x2y0tkbj9g60hlziv8q2c8hmtbld7gj7lz", tier: "SIMPLE" },
  ]
});

console.log("Loaded providers:", config.providers.length);

const proxy = await startProxy({ 
  port: 8402, 
  igniteConfig: config,
  onReady: (port) => console.log("Proxy on port", port),
  onRouted: (d) => console.log("Routed:", d.model, d.tier)
});

console.log("Ready");
setTimeout(() => {}, 3600000);
