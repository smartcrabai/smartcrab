import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import YAML from "yaml";

import {
  configurePipelineAuthorCommands,
  pipelineAuthor,
  buildSystemPrompt,
  makePipelineListTool,
  makePipelineGetTool,
  makePipelineEditTool,
  makePipelineDeleteTool,
  PIPELINE_LIST_TOOL_NAME,
  PIPELINE_GET_TOOL_NAME,
  PIPELINE_EDIT_TOOL_NAME,
  PIPELINE_DELETE_TOOL_NAME,
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

describe("pipeline management tools", () => {
  // Loosely typed view of a tool, mirroring how router.ts drives them: parse
  // the input, then call the handler. Lets the tests poke parse/handler without
  // wrestling each factory's precise inferred signatures.
  type LooseTool = {
    name: string;
    parameters: { parse: (i: unknown) => unknown };
    handler: (a?: unknown) => unknown;
  };

  it("list tool takes no params and returns the listing string", async () => {
    const tool = makePipelineListTool({
      description: "list",
      onList: () => "[]",
    }) as unknown as LooseTool;
    expect(tool.name).toBe(PIPELINE_LIST_TOOL_NAME);
    // Router parses params before calling handler; an empty object is valid.
    tool.parameters.parse({});
    expect(await tool.handler()).toBe("[]");
  });

  it("get tool forwards the id and rejects an empty id", async () => {
    let fetched = "";
    const tool = makePipelineGetTool({
      description: "get",
      onGet: (id) => {
        fetched = id;
        return "{}";
      },
    }) as unknown as LooseTool;
    expect(tool.name).toBe(PIPELINE_GET_TOOL_NAME);

    const parsed = tool.parameters.parse({ id: "pl-3" });
    expect(await tool.handler(parsed)).toBe("{}");
    expect(fetched).toBe("pl-3");

    expect(() => tool.parameters.parse({ id: "" })).toThrow();
  });

  it("edit tool requires an id and forwards a clean definition", async () => {
    let seenId = "";
    let seenName = "";
    const tool = makePipelineEditTool({
      description: "edit",
      onEdit: (id, pipeline) => {
        seenId = id;
        seenName = pipeline.name;
        // `id` must be stripped before reaching the callback.
        expect("id" in pipeline).toBe(false);
        return "ok";
      },
    }) as unknown as LooseTool;
    expect(tool.name).toBe(PIPELINE_EDIT_TOOL_NAME);

    const parsed = tool.parameters.parse({ ...VALID_PIPELINE, id: "pl-42" });
    expect(await tool.handler(parsed)).toBe("ok");
    expect(seenId).toBe("pl-42");
    expect(seenName).toBe("demo");
  });

  it("edit tool rejects a missing id", () => {
    const tool = makePipelineEditTool({
      description: "edit",
      onEdit: () => "ok",
    }) as unknown as LooseTool;
    expect(() => tool.parameters.parse(VALID_PIPELINE)).toThrow();
  });

  it("delete tool forwards the id and rejects an empty id", async () => {
    let deleted = "";
    const tool = makePipelineDeleteTool({
      description: "delete",
      onDelete: (id) => {
        deleted = id;
        return "gone";
      },
    }) as unknown as LooseTool;
    expect(tool.name).toBe(PIPELINE_DELETE_TOOL_NAME);

    const parsed = tool.parameters.parse({ id: "pl-7" });
    expect(await tool.handler(parsed)).toBe("gone");
    expect(deleted).toBe("pl-7");

    expect(() => tool.parameters.parse({ id: "" })).toThrow();
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
