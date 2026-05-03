import { describe, expect, test } from "bun:test";

import type { SeherSettings } from "../seher-shape.ts";
import type { SmartCrabConfig } from "../smartcrab-config.ts";
import { translate } from "../translate.ts";

interface Case {
  readonly name: string;
  readonly input: SmartCrabConfig;
  readonly expected: SeherSettings;
}

const cases: readonly Case[] = [
  {
    name: "empty config produces empty agents and only fallback in priority when fallback unknown is dropped",
    input: {
      providers: [],
      priority: [],
      defaults: { fallbackProviderId: "missing", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [],
      // fallback が providers に存在しないので priority には何も足されない
      priority: [],
    },
  },
  {
    name: "single provider without rules: fallback adds weight=0 priority entry",
    input: {
      providers: [{ id: "main", kind: "claude" }],
      priority: [],
      defaults: { fallbackProviderId: "main", rateLimitBackoffSec: 60 },
    },
    expected: {
      agents: [{ name: "main", provider: "claude" }],
      priority: [{ agent: "main", weight: 0 }],
    },
  },
  {
    name: "multi provider with priority: weights preserved, fallback already covered",
    input: {
      providers: [
        { id: "primary", kind: "claude", model: "claude-sonnet-4.7" },
        { id: "secondary", kind: "kimi" },
      ],
      priority: [
        { providerId: "primary", weight: 100 },
        { providerId: "secondary", weight: 10 },
      ],
      defaults: { fallbackProviderId: "secondary", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [
        { name: "primary", provider: "claude", model: "claude-sonnet-4.7" },
        { name: "secondary", provider: "kimi" },
      ],
      priority: [
        { agent: "primary", weight: 100 },
        { agent: "secondary", weight: 10 },
      ],
    },
  },
  {
    name: "time windows: weekdays + hours collapsed to seher TimeWindow",
    input: {
      providers: [{ id: "weekday-bot", kind: "copilot" }],
      priority: [
        {
          providerId: "weekday-bot",
          weight: 5,
          weekdays: [1, 2, 3, 4, 5],
          hours: [9, 18],
        },
      ],
      defaults: {
        fallbackProviderId: "weekday-bot",
        rateLimitBackoffSec: 15,
      },
    },
    expected: {
      agents: [
        {
          name: "weekday-bot",
          provider: "copilot",
          timeWindows: [
            { weekday: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
          ],
        },
      ],
      priority: [{ agent: "weekday-bot", weight: 5 }],
    },
  },
  {
    name: "env overrides flow through to seher env",
    input: {
      providers: [
        {
          id: "kimi-jp",
          kind: "kimi",
          envOverrides: { KIMI_REGION: "jp", KIMI_LOG: "debug" },
        },
      ],
      priority: [{ providerId: "kimi-jp", weight: 50 }],
      defaults: { fallbackProviderId: "kimi-jp", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [
        {
          name: "kimi-jp",
          provider: "kimi",
          env: { KIMI_REGION: "jp", KIMI_LOG: "debug" },
        },
      ],
      priority: [{ agent: "kimi-jp", weight: 50 }],
    },
  },
  {
    name: "multiple rules per provider collapse to max weight + multiple time windows",
    input: {
      providers: [{ id: "shift-bot", kind: "claude" }],
      priority: [
        {
          providerId: "shift-bot",
          weight: 1,
          weekdays: [1, 2, 3, 4, 5],
          hours: [9, 18],
        },
        {
          providerId: "shift-bot",
          weight: 7,
          weekdays: [0, 6],
          hours: [10, 22],
        },
      ],
      defaults: { fallbackProviderId: "shift-bot", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [
        {
          name: "shift-bot",
          provider: "claude",
          timeWindows: [
            { weekday: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
            { weekday: [0, 6], startHour: 10, endHour: 22 },
          ],
        },
      ],
      priority: [{ agent: "shift-bot", weight: 7 }],
    },
  },
  {
    name: "rule referencing unknown provider is silently ignored",
    input: {
      providers: [{ id: "real", kind: "claude" }],
      priority: [
        { providerId: "real", weight: 3 },
        { providerId: "ghost", weight: 999 },
      ],
      defaults: { fallbackProviderId: "real", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [{ name: "real", provider: "claude" }],
      priority: [{ agent: "real", weight: 3 }],
    },
  },
  {
    name: "empty envOverrides is omitted (no empty env object emitted)",
    input: {
      providers: [{ id: "p", kind: "claude", envOverrides: {} }],
      priority: [{ providerId: "p", weight: 1 }],
      defaults: { fallbackProviderId: "p", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [{ name: "p", provider: "claude" }],
      priority: [{ agent: "p", weight: 1 }],
    },
  },
  {
    name: "rule with only hours (no weekdays) yields empty weekday array",
    input: {
      providers: [{ id: "night", kind: "claude" }],
      priority: [{ providerId: "night", weight: 2, hours: [22, 24] }],
      defaults: { fallbackProviderId: "night", rateLimitBackoffSec: 30 },
    },
    expected: {
      agents: [
        {
          name: "night",
          provider: "claude",
          timeWindows: [{ weekday: [], startHour: 22, endHour: 24 }],
        },
      ],
      priority: [{ agent: "night", weight: 2 }],
    },
  },
];

describe("translate(SmartCrabConfig) -> SeherSettings", () => {
  for (const c of cases) {
    test(c.name, () => {
      const out = translate(c.input);
      expect(out).toEqual(c.expected);
    });
  }

  test("translate is pure: same input twice yields equal but independent output", () => {
    const input: SmartCrabConfig = {
      providers: [{ id: "a", kind: "claude", envOverrides: { K: "v" } }],
      priority: [{ providerId: "a", weight: 1 }],
      defaults: { fallbackProviderId: "a", rateLimitBackoffSec: 30 },
    };
    const a = translate(input);
    const b = translate(input);
    expect(a).toEqual(b);
    // env を mutate しても元 input が壊れていないことを確認
    const firstAgent = a.agents[0];
    if (firstAgent && firstAgent.env) {
      const mutable = firstAgent.env as Record<string, string>;
      mutable.K = "mutated";
    }
    expect(input.providers[0]?.envOverrides?.K).toBe("v");
  });

  test("condition field on PriorityRule is non-functional (not propagated)", () => {
    const out = translate({
      providers: [{ id: "x", kind: "claude" }],
      priority: [
        { providerId: "x", weight: 1, condition: "user-flag:beta" },
      ],
      defaults: { fallbackProviderId: "x", rateLimitBackoffSec: 30 },
    });
    expect(out.agents[0]).not.toHaveProperty("condition");
    expect(out.priority[0]).not.toHaveProperty("condition");
  });
});
