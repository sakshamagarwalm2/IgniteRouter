// Backwards compatibility wrapper - actual implementation moved to openclaw-providers.ts
export {
  type IgniteProvider as UserProvider,
  type IgniteConfig,
  type ProviderPriority,
  loadProvidersFromOpenClaw as loadProviders,
  createIgniteConfig,
} from "./openclaw-providers.js";

export { ComplexityTier } from "./complexity-scorer.js";
export { TaskType } from "./task-classifier.js";
