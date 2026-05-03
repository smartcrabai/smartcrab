/**
 * Skill auto-generation.
 *
 * Inspired by hermes-agent's "skill from trajectory" loop: given a window of
 * execution traces, ask the LLM to extract a generalized, reusable skill in
 * the same Markdown format the rest of the system consumes.
 *
 * The LLM is injected (DI) so tests can mock it and so production wiring can
 * pick the cheapest available provider via seher-ts.
 */

import type {
  ExecutionTrace,
  LlmAdapter,
  SkillCreateInput,
} from "./types.ts";

const SYSTEM_PROMPT = `You are SmartCrab's skill author. Given a JSON array of \
execution traces (action, input, output, optional note), distill a single \
reusable skill that captures the recurring pattern. Reply with a fenced JSON \
object on the first line and a Markdown body following it.

The JSON object must use this shape:
  {"name": string, "description": string}

The Markdown body should be self-contained instructions an agent can follow \
to perform the generalized task. Do NOT include trace-specific identifiers, \
secrets, or one-off values; generalize parameters into placeholders like \
{{topic}} or {{user_id}} where appropriate.`;

/** Build the user-facing prompt for a given window of traces. */
export function buildAutoGenPrompt(traces: ExecutionTrace[]): string {
  const tracesJson = JSON.stringify(traces, null, 2);
  return `${SYSTEM_PROMPT}\n\n# Traces\n\n\`\`\`json\n${tracesJson}\n\`\`\``;
}

/**
 * Parse the LLM's response into a `SkillCreateInput`.
 *
 * Tolerates a few common shapes:
 *   1. JSON object on line 1, Markdown body following.
 *   2. Fenced ```json block, then Markdown body.
 *   3. JSON-only (uses description as body fallback).
 */
export function parseAutoGenResponse(content: string): SkillCreateInput {
  const trimmed = content.trim();

  // Case 2: ```json fenced block.
  const fenceMatch = trimmed.match(/^```json\s*\n([\s\S]*?)\n```\s*([\s\S]*)$/);
  if (fenceMatch?.[1]) {
    const meta = safeParseJson(fenceMatch[1]);
    const body = (fenceMatch[2] ?? "").trim();
    return toSkillInput(meta, body || (meta?.description as string) || "");
  }

  // Case 1: JSON object on the first line, body after the first newline.
  const newlineIdx = trimmed.indexOf("\n");
  if (newlineIdx > 0) {
    const head = trimmed.slice(0, newlineIdx).trim();
    const tail = trimmed.slice(newlineIdx + 1).trim();
    if (head.startsWith("{") && head.endsWith("}")) {
      const meta = safeParseJson(head);
      if (meta) {
        return toSkillInput(meta, tail || (meta.description as string) || "");
      }
    }
  }

  // Case 3: JSON-only.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const meta = safeParseJson(trimmed);
    if (meta) {
      return toSkillInput(meta, (meta.description as string) || "");
    }
  }

  // Last-ditch fallback: treat the whole response as the body.
  return {
    name: "auto-generated-skill",
    description: null,
    skill_type: "auto-generated",
    body: trimmed,
  };
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toSkillInput(
  meta: Record<string, unknown> | null,
  body: string,
): SkillCreateInput {
  const name =
    typeof meta?.name === "string" && meta.name.trim().length > 0
      ? meta.name.trim()
      : "auto-generated-skill";
  const description =
    typeof meta?.description === "string" ? meta.description : null;
  return {
    name,
    description,
    skill_type: "auto-generated",
    body,
  };
}

/**
 * Run the auto-generation loop end-to-end.
 *
 * @param traces  Execution traces to learn from. Caller is responsible for
 *                windowing / sampling (e.g. last 50 events).
 * @param llm     Injected LLM adapter.
 */
export async function autoGenerate(
  traces: ExecutionTrace[],
  llm: LlmAdapter,
): Promise<SkillCreateInput> {
  if (traces.length === 0) {
    throw new Error("autoGenerate: traces must not be empty");
  }
  const prompt = buildAutoGenPrompt(traces);
  const response = await llm.execute_prompt({ prompt });
  return parseAutoGenResponse(response.content);
}
