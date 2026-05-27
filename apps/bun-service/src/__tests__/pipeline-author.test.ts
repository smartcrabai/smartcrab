import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import YAML from "yaml";

import {
  configurePipelineAuthorCommands,
  pipelineAuthor,
  buildSystemPrompt,
  type PipelineAuthorParams,
} from "../commands/pipeline-author.commands.ts";
import type { RouteRequest } from "../router.ts";
import { silenceConsoleError } from "./test-helpers.ts";

const consoleSpy = silenceConsoleError();
beforeEach(() => consoleSpy.setup());
afterEach(() => consoleSpy.restore());

const VALID_PIPELINE = {
  name: "demo",
  version: "1.0",
  trigger: { type: "discord", triggers: ["go"] },
  nodes: [
    {
      id: "think",
      name: "Think",
      action: { type: "llm_call", provider: "anthropic", prompt: "hi", timeout_secs: 30 },
    },
  ],
};

/**
 * Build a mock `route` that mimics router.ts: it runs `parameters.parse` on
 * the candidate and, if valid, calls the tool's handler — exactly the path a
 * real provider tool-use round would take.
 */
function mockRouteEmitting(candidate: unknown, text = "Here is your pipeline.") {
  return async (req: RouteRequest) => {
    const tool = req.tools?.[0] as
      | { parameters: { parse: (i: unknown) => unknown }; handler: (a: unknown) => unknown }
      | undefined;
    if (tool) {
      const parsed = tool.parameters.parse(candidate); // throws on invalid
      await tool.handler(parsed);
    }
    return { text, kind: "mock" };
  };
}

/** A mock route that never calls the tool (LLM ignored instructions). */
function mockRouteNoTool() {
  return async (_req: RouteRequest) => ({ text: "I won't use the tool.", kind: "mock" });
}

describe("pipeline.author", () => {
  it("serializes a tool-emitted pipeline to YAML", async () => {
    configurePipelineAuthorCommands({
      listProviders: () => ["anthropic"],
      listChatAdapters: () => ["discord"],
      route: mockRouteEmitting(VALID_PIPELINE),
    });

    const result = await pipelineAuthor({ instruction: "make a discord summarizer" });
    expect(result.kind).toBe("mock");
    expect(result.explanation).toContain("pipeline");

    const parsed = YAML.parse(result.yaml);
    expect(parsed.name).toBe("demo");
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].action.type).toBe("llm_call");
  });

  it("passes currentYaml through for refinement", async () => {
    let seenPrompt = "";
    configurePipelineAuthorCommands({
      listProviders: () => ["anthropic"],
      listChatAdapters: () => ["discord"],
      route: async (req) => {
        seenPrompt = req.prompt;
        const tool = req.tools?.[0] as { parameters: { parse: (i: unknown) => unknown }; handler: (a: unknown) => unknown };
        await tool.handler(tool.parameters.parse(VALID_PIPELINE));
        return { text: "refined", kind: "mock" };
      },
    });

    const params: PipelineAuthorParams = {
      instruction: "rename to demo",
      current_yaml: "name: old\nversion: \"1.0\"\ntrigger:\n  type: cron\n  schedule: \"* * * * *\"\nnodes:\n  - id: a\n    name: A\n",
    };
    await pipelineAuthor(params);
    expect(seenPrompt).toContain("Current pipeline");
    expect(seenPrompt).toContain("name: old");
  });

  it("throws after retries when the LLM never calls submit_pipeline", async () => {
    configurePipelineAuthorCommands({
      listProviders: () => [],
      listChatAdapters: () => [],
      route: mockRouteNoTool(),
      maxOuterRetries: 1,
    });

    await expect(pipelineAuthor({ instruction: "nope" })).rejects.toThrow(
      /did not call submit_pipeline/,
    );
  });

  it("rejects empty instruction", async () => {
    configurePipelineAuthorCommands({
      listProviders: () => [],
      listChatAdapters: () => [],
      route: mockRouteEmitting(VALID_PIPELINE),
    });
    await expect(pipelineAuthor({ instruction: "  " })).rejects.toThrow(/non-empty/);
  });

  it("surfaces Zod parse failures (invalid pipeline) as no-capture → retry → throw", async () => {
    // Missing required `name`/`nodes` — parameters.parse should throw inside the
    // mock route, so nothing is captured and the outer loop exhausts.
    configurePipelineAuthorCommands({
      listProviders: () => [],
      listChatAdapters: () => [],
      maxOuterRetries: 0,
      route: async (req) => {
        const tool = req.tools?.[0] as { parameters: { parse: (i: unknown) => unknown }; handler: (a: unknown) => unknown };
        try {
          await tool.handler(tool.parameters.parse({ version: "1.0" }));
        } catch {
          // emulate router.ts swallowing the parse error into a tool-result string
        }
        return { text: "tried", kind: "mock" };
      },
    });
    await expect(pipelineAuthor({ instruction: "bad" })).rejects.toThrow();
  });
});

describe("buildSystemPrompt", () => {
  it("embeds providers and chat adapters", () => {
    const prompt = buildSystemPrompt({ providers: ["anthropic", "copilot"], chatAdapters: ["discord"] });
    expect(prompt).toContain("anthropic, copilot");
    expect(prompt).toContain("discord");
    expect(prompt).toContain("submit_pipeline");
  });

  it("handles empty provider/adapter lists", () => {
    const prompt = buildSystemPrompt({ providers: [], chatAdapters: [] });
    expect(prompt).toContain("(none configured)");
    expect(prompt).toContain("(none registered)");
  });
});
