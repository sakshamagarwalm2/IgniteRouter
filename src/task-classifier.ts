export enum TaskType {
  Chat = "chat",
  Creative = "creative",
  Reasoning = "reasoning",
  Agentic = "agentic",
  Vision = "vision",
  Deep = "deep",
}

export interface ClassificationResult {
  taskType: TaskType;
  confidence: "high" | "signal" | "keyword" | "default";
  reason: string;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.content === "string") return obj.content;
        }
        if (typeof item === "string") return item;
        return "";
      })
      .join(" ");
  }
  return "";
}

function getLastUserMessage(messages: Array<{ role: string; content: unknown }>): string {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return "";
  return extractTextContent(userMessages[userMessages.length - 1].content);
}

function containsImageContent(content: unknown): boolean {
  if (typeof content === "string") return false;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.type === "image_url" || obj.type === "image") return true;
        if (obj.type === "text" && obj.text && containsImageContent(obj.text)) return true;
      }
    }
  }
  return false;
}

function hasImageInMessages(messages: Array<{ role: string; content: unknown }>): boolean {
  for (const msg of messages) {
    if (containsImageContent(msg.content)) return true;
  }
  return false;
}

function findMatchingPattern(text: string, patterns: RegExp[]): string | null {
  const lowerText = text.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.test(lowerText)) {
      const match = lowerText.match(pattern);
      return match ? match[0] : pattern.source;
    }
  }
  return null;
}

const REASONING_PATTERNS = [
  /analyse|analyze|analysis|analyzing/,
  /compare|comparing|comparison/,
  /decide|decision|deciding/,
  /should i|which is better|what.*better/,
  /evaluate|evaluation|evaluating/,
  /pros and cons|pros\s*&\s*cons|advantages?\s*(?:and|vs)\s*disadvantages?/,
  /tradeoffs?|trade\s*offs?/,
  /step by step/,
  /explain why|reasoning|reasons?\s+(?:for|because)/,
  /think through|thinking/,
  /plan|planning|strategy|strategic/,
  /recommend|recommendation/,
  /assess|assessments?/,
  /investigate|investigation/,
];

const CREATIVE_PATTERNS = [
  /write a|write an/,
  /story|stories|fiction|narrative/,
  /poem|poetry|verse/,
  /creative|creativity|creatively/,
  /brainstorm|brainstorming|ideas?/,
  /imagine|imagination/,
  /invent|invention/,
  /generate ideas|coming up with/,
  /script|dialogue|dialog|screenplay/,
  /song|lyrics|music/,
  /essay|article|blog/,
  /design\s+(?:a|this|my)/,
  /storytelling/,
];

const DEEP_PATTERNS = [
  /prove|proof|theorem|lemma|corollary/,
  /formally|formal\s+(?:definition|specification|proof)/,
  /architect\s+(?:a|an|the|this)/,
  /design\s+(?:a|an|the)?\s*system/,
  /in\s+depth|comprehensive|thorough/,
  /detailed\s+analysis|analysis\s+of/,
  /research\s+(?:paper|paper|disquisition)/,
  /dissertation|thesis/,
  /whitepaper/,
  /system\s+architecture/,
  /reference\s+implementation/,
  /exhaustive|encyclopedic/,
];

const AGENTIC_PATTERNS = [
  /search\s+(?:the\s+)?web|search\s+(?:and|for)/,
  /browse|look\s+up|find\s+information/,
  /execute|execution/,
  /run\s+(?:this|this\s+code|the\s+)/,
  /automate|automation/,
  /multi-?step|multi\s+step/,
  /step\s+1|first\s+step|then\s+(?:next|second)/,
  /workflow|workflows/,
  /agent/,
  /gather.*information|collect.*data/,
  /summarize.*results|summary.*of.*findings/,
];

export function classifyTask(
  messages: Array<{ role: string; content: unknown }>,
  tools?: unknown[],
  estimatedTokens?: number,
): ClassificationResult {
  if (hasImageInMessages(messages)) {
    return {
      taskType: TaskType.Vision,
      confidence: "signal",
      reason: "image detected in content",
    };
  }

  const hasTools = Array.isArray(tools) && tools.length > 0;
  const lastUserMsg = getLastUserMessage(messages);

  if (hasTools) {
    return {
      taskType: TaskType.Agentic,
      confidence: "signal",
      reason: "tools array present",
    };
  }

  const agenticMatch = findMatchingPattern(lastUserMsg, AGENTIC_PATTERNS);
  if (agenticMatch) {
    return {
      taskType: TaskType.Agentic,
      confidence: "keyword",
      reason: `keyword: ${agenticMatch}`,
    };
  }

  if (estimatedTokens !== undefined && estimatedTokens > 8000) {
    return {
      taskType: TaskType.Deep,
      confidence: "signal",
      reason: `token count ${estimatedTokens} > 8000`,
    };
  }

  const deepMatch = findMatchingPattern(lastUserMsg, DEEP_PATTERNS);
  if (deepMatch) {
    return {
      taskType: TaskType.Deep,
      confidence: "keyword",
      reason: `keyword: ${deepMatch}`,
    };
  }

  const reasoningMatch = findMatchingPattern(lastUserMsg, REASONING_PATTERNS);
  if (reasoningMatch) {
    return {
      taskType: TaskType.Reasoning,
      confidence: "keyword",
      reason: `keyword: ${reasoningMatch}`,
    };
  }

  const creativeMatch = findMatchingPattern(lastUserMsg, CREATIVE_PATTERNS);
  if (creativeMatch) {
    return {
      taskType: TaskType.Creative,
      confidence: "keyword",
      reason: `keyword: ${creativeMatch}`,
    };
  }

  return {
    taskType: TaskType.Chat,
    confidence: "default",
    reason: "default fallback",
  };
}
