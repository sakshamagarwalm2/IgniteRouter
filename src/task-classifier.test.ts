import { describe, expect, it } from "vitest";
import { classifyTask, TaskType } from "./task-classifier.js";

function makeMsg(role: string, content: string) {
  return { role, content };
}

function makeVisionMsg() {
  return {
    role: "user",
    content: [
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
    ],
  };
}

function makeAgenticMsg() {
  return {
    role: "user",
    content: [{ type: "text", text: "Search the web and summarise results about AI" }],
  };
}

describe("task-classifier", () => {
  describe("Chat", () => {
    it('"hello how are you" → Chat', () => {
      const result = classifyTask([makeMsg("user", "hello how are you")]);
      expect(result.taskType).toBe(TaskType.Chat);
    });

    it('"what is the capital of France" → Chat', () => {
      const result = classifyTask([makeMsg("user", "what is the capital of France")]);
      expect(result.taskType).toBe(TaskType.Chat);
    });

    it('"translate this to Hindi" → Chat', () => {
      const result = classifyTask([makeMsg("user", "translate this to Hindi")]);
      expect(result.taskType).toBe(TaskType.Chat);
    });
  });

  describe("Creative", () => {
    it('"write a short story about a robot" → Creative', () => {
      const result = classifyTask([makeMsg("user", "write a short story about a robot")]);
      expect(result.taskType).toBe(TaskType.Creative);
    });

    it('"brainstorm ideas for my startup" → Creative', () => {
      const result = classifyTask([makeMsg("user", "brainstorm ideas for my startup")]);
      expect(result.taskType).toBe(TaskType.Creative);
    });

    it('"write a poem about the ocean" → Creative', () => {
      const result = classifyTask([makeMsg("user", "write a poem about the ocean")]);
      expect(result.taskType).toBe(TaskType.Creative);
    });

    it('"imagine a world where AI is conscious" → Creative', () => {
      const result = classifyTask([makeMsg("user", "imagine a world where AI is conscious")]);
      expect(result.taskType).toBe(TaskType.Creative);
    });
  });

  describe("Reasoning", () => {
    it('"analyse the pros and cons of React vs Vue" → Reasoning', () => {
      const result = classifyTask([makeMsg("user", "analyse the pros and cons of React vs Vue")]);
      expect(result.taskType).toBe(TaskType.Reasoning);
    });

    it('"should I use PostgreSQL or MongoDB" → Reasoning', () => {
      const result = classifyTask([makeMsg("user", "should I use PostgreSQL or MongoDB")]);
      expect(result.taskType).toBe(TaskType.Reasoning);
    });

    it('"step by step explain how TCP works" → Reasoning', () => {
      const result = classifyTask([makeMsg("user", "step by step explain how TCP works")]);
      expect(result.taskType).toBe(TaskType.Reasoning);
    });

    it('"compare these two business strategies" → Reasoning', () => {
      const result = classifyTask([makeMsg("user", "compare these two business strategies")]);
      expect(result.taskType).toBe(TaskType.Reasoning);
    });

    it('"plan my marketing strategy for Q3" → Reasoning (not Deep — token count low)', () => {
      const result = classifyTask([makeMsg("user", "plan my marketing strategy for Q3")]);
      expect(result.taskType).toBe(TaskType.Reasoning);
    });
  });

  describe("Agentic", () => {
    it("[request with tools array] → Agentic", () => {
      const tools = [{ type: "function", function: { name: "web_search" } }];
      const result = classifyTask([makeMsg("user", "hello")], tools);
      expect(result.taskType).toBe(TaskType.Agentic);
      expect(result.confidence).toBe("signal");
      expect(result.reason).toBe("tools array present");
    });

    it('"search the web and summarise results" → Agentic', () => {
      const result = classifyTask([makeMsg("user", "search the web and summarise results")]);
      expect(result.taskType).toBe(TaskType.Agentic);
    });

    it('"execute this workflow step by step" → Agentic', () => {
      const result = classifyTask([makeMsg("user", "execute this workflow step by step")]);
      expect(result.taskType).toBe(TaskType.Agentic);
    });
  });

  describe("Vision", () => {
    it("[request with image in content] → Vision", () => {
      const result = classifyTask([makeVisionMsg()]);
      expect(result.taskType).toBe(TaskType.Vision);
      expect(result.confidence).toBe("signal");
      expect(result.reason).toBe("image detected in content");
    });
  });

  describe("Deep", () => {
    it("[prompt with 9000+ tokens estimated] → Deep", () => {
      const result = classifyTask([makeMsg("user", "hello")], undefined, 9000);
      expect(result.taskType).toBe(TaskType.Deep);
      expect(result.confidence).toBe("signal");
    });

    it('"prove that sqrt(2) is irrational" → Deep', () => {
      const result = classifyTask([makeMsg("user", "prove that sqrt(2) is irrational")]);
      expect(result.taskType).toBe(TaskType.Deep);
    });

    it('"architect a distributed system for..." → Deep', () => {
      const result = classifyTask([
        makeMsg("user", "architect a distributed system for handling millions of requests"),
      ]);
      expect(result.taskType).toBe(TaskType.Deep);
    });

    it('"write a comprehensive research paper on..." → Deep', () => {
      const result = classifyTask([
        makeMsg("user", "write a comprehensive research paper on machine learning"),
      ]);
      expect(result.taskType).toBe(TaskType.Deep);
    });
  });

  describe("Confidence levels", () => {
    it("Vision uses 'signal' confidence", () => {
      const result = classifyTask([makeVisionMsg()]);
      expect(result.confidence).toBe("signal");
    });

    it("Agentic with tools uses 'signal' confidence", () => {
      const result = classifyTask([makeMsg("user", "hello")], [{ type: "function" }]);
      expect(result.confidence).toBe("signal");
    });

    it("Keyword matches use 'keyword' confidence", () => {
      const result = classifyTask([makeMsg("user", "analyse this data")]);
      expect(result.confidence).toBe("keyword");
    });

    it("Deep via token count uses 'signal' confidence", () => {
      const result = classifyTask([makeMsg("user", "hello")], undefined, 10000);
      expect(result.confidence).toBe("signal");
    });

    it("Default Chat uses 'default' confidence", () => {
      const result = classifyTask([makeMsg("user", "hello")]);
      expect(result.confidence).toBe("default");
    });
  });
});
