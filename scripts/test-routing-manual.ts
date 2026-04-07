import { route, type RoutingContext } from "./dist/routing-engine.js";
import { IgniteConfig, type UserProvider } from "./dist/user-providers.js";

const providers: UserProvider[] = [
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
    tier: "EXPERT",
  },
];

const config: IgniteConfig = {
  defaultPriority: "cost",
  providers,
};

const prompts = [
  "Hi there! Just give me a quick 1-sentence summary of what a router does.",
  "Compare the architectural differences between a monolithic and microservices approach for a high-traffic e-commerce site. Provide a pros/cons table.",
  "Write a complex Python script that uses asyncio to scrape 5 different websites, handles rate limiting, and stores the results in a PostgreSQL database using SQLAlchemy. Include error handling for network timeouts.",
];

for (let i = 0; i < prompts.length; i++) {
  const prompt = prompts[i];
  console.log(`\n=== Prompt ${i + 1} ===`);
  console.log(`Prompt: ${prompt.substring(0, 60)}...`);

  const context: RoutingContext = {
    messages: [{ role: "user", content: prompt }],
  };

  const decision = await route(context, config);
  console.log(`Task: ${decision.taskType}`);
  console.log(`Tier: ${decision.tier}`);
  console.log(`Model: ${decision.candidateProviders[0]?.id || "none"}`);
  console.log(`Error: ${decision.error || "none"}`);
}
