import { describe, expect, test } from "bun:test";

import type { SeherConfig } from "../seher-shape.ts";
import type { SmartCrabConfig } from "../smartcrab-config.ts";
import { translate } from "../translate.ts";

interface Case {
  readonly name: string;
  readonly input: SmartCrabConfig;
  readonly expected: SeherConfig;
}

const cases: readonly Case[] = [
  {
    name: "empty config produces empty providers map",
    input: {
      providers: [],
      priority: [],
      defaults: { fallbackProviderId: "missing", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {},
    },
  },
  {
    name: "single provider without rules: anthropic → sdk:claude",
    input: {
      providers: [{ id: "main", kind: "anthropic" }],
      priority: [],
      defaults: { fallbackProviderId: "main", rateLimitBackoffSec: 60 },
    },
    expected: {
      providers: {
        main: {
          provider: "anthropic",
          sdk: "claude",
          models: {},
        },
      },
    },
  },
  {
    name: "multi provider with priority weights preserved as per-provider priority",
    input: {
      providers: [
        { id: "primary", kind: "anthropic", model: "claude-sonnet-4.7" },
        { id: "secondary", kind: "openai" },
      ],
      priority: [
        { providerId: "primary", weight: 100 },
        { providerId: "secondary", weight: 10 },
      ],
      defaults: { fallbackProviderId: "secondary", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        primary: {
          provider: "anthropic",
          sdk: "claude",
          priority: 100,
          models: { build: { model: "claude-sonnet-4.7" } },
        },
        secondary: {
          provider: "openai",
          sdk: "pi",
          priority: 10,
          models: {},
        },
      },
    },
  },
  {
    name: "openai model gets openai/ prefix when no slash present",
    input: {
      providers: [
        { id: "gpt", kind: "openai", model: "gpt-4o" },
      ],
      priority: [{ providerId: "gpt", weight: 50 }],
      defaults: { fallbackProviderId: "gpt", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        gpt: {
          provider: "openai",
          sdk: "pi",
          priority: 50,
          models: { build: { model: "openai/gpt-4o" } },
        },
      },
    },
  },
  {
    name: "openai model with slash is passed through unchanged",
    input: {
      providers: [
        { id: "gpt", kind: "openai", model: "openai/gpt-5" },
      ],
      priority: [{ providerId: "gpt", weight: 50 }],
      defaults: { fallbackProviderId: "gpt", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        gpt: {
          provider: "openai",
          sdk: "pi",
          priority: 50,
          models: { build: { model: "openai/gpt-5" } },
        },
      },
    },
  },
  {
    name: "openai env overrides map to api.key and api.endpoint",
    input: {
      providers: [
        {
          id: "openai-prod",
          kind: "openai",
          envOverrides: { OPENAI_API_KEY: "sk-abc123", OPENAI_BASE_URL: "https://api.openai.com/v1" },
        },
      ],
      priority: [{ providerId: "openai-prod", weight: 50 }],
      defaults: { fallbackProviderId: "openai-prod", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        "openai-prod": {
          provider: "openai",
          sdk: "pi",
          priority: 50,
          api: { key: "sk-abc123", endpoint: "https://api.openai.com/v1" },
          models: {},
        },
      },
    },
  },
  {
    name: "openai env overrides with only api key (no base url)",
    input: {
      providers: [
        {
          id: "openai-keyonly",
          kind: "openai",
          envOverrides: { OPENAI_API_KEY: "sk-xyz" },
        },
      ],
      priority: [{ providerId: "openai-keyonly", weight: 1 }],
      defaults: { fallbackProviderId: "openai-keyonly", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        "openai-keyonly": {
          provider: "openai",
          sdk: "pi",
          priority: 1,
          api: { key: "sk-xyz" },
          models: {},
        },
      },
    },
  },
  {
    name: "openai env overrides with only base url (no api key)",
    input: {
      providers: [
        {
          id: "openai-endpoint",
          kind: "openai",
          envOverrides: { OPENAI_BASE_URL: "https://custom.example.com/v1" },
        },
      ],
      priority: [{ providerId: "openai-endpoint", weight: 1 }],
      defaults: { fallbackProviderId: "openai-endpoint", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        "openai-endpoint": {
          provider: "openai",
          sdk: "pi",
          priority: 1,
          api: { endpoint: "https://custom.example.com/v1" },
          models: {},
        },
      },
    },
  },
  {
    name: "non-openai env overrides do NOT produce api section",
    input: {
      providers: [
        {
          id: "claude-eu",
          kind: "anthropic",
          envOverrides: { ANTHROPIC_API_KEY: "sk-ant-xyz", UNUSED_VAR: "eu" },
        },
      ],
      priority: [{ providerId: "claude-eu", weight: 1 }],
      defaults: { fallbackProviderId: "claude-eu", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        "claude-eu": {
          provider: "anthropic",
          sdk: "claude",
          priority: 1,
          models: {},
        },
      },
    },
  },
  {
    name: "copilot provider maps to sdk:copilot",
    input: {
      providers: [{ id: "gh", kind: "copilot" }],
      priority: [{ providerId: "gh", weight: 10 }],
      defaults: { fallbackProviderId: "gh", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        gh: {
          provider: "copilot",
          sdk: "copilot",
          priority: 10,
          models: {},
        },
      },
    },
  },
  {
    name: "multiple rules per provider collapse to max weight",
    input: {
      providers: [{ id: "shift-bot", kind: "anthropic" }],
      priority: [
        { providerId: "shift-bot", weight: 1, weekdays: [1, 2, 3, 4, 5], hours: [9, 18] },
        { providerId: "shift-bot", weight: 7, weekdays: [0, 6], hours: [10, 22] },
      ],
      defaults: { fallbackProviderId: "shift-bot", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        "shift-bot": {
          provider: "anthropic",
          sdk: "claude",
          priority: 7,
          models: {},
        },
      },
    },
  },
  {
    name: "rule referencing unknown provider is silently ignored",
    input: {
      providers: [{ id: "real", kind: "anthropic" }],
      priority: [
        { providerId: "real", weight: 3 },
        { providerId: "ghost", weight: 999 },
      ],
      defaults: { fallbackProviderId: "real", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        real: {
          provider: "anthropic",
          sdk: "claude",
          priority: 3,
          models: {},
        },
      },
    },
  },
  {
    name: "empty envOverrides is omitted (no empty api object emitted)",
    input: {
      providers: [{ id: "p", kind: "openai", envOverrides: {} }],
      priority: [{ providerId: "p", weight: 1 }],
      defaults: { fallbackProviderId: "p", rateLimitBackoffSec: 30 },
    },
    expected: {
      providers: {
        p: {
          provider: "openai",
          sdk: "pi",
          priority: 1,
          models: {},
        },
      },
    },
  },
];

describe("translate(SmartCrabConfig) -> SeherConfig (providers map)", () => {
  for (const c of cases) {
    test(c.name, () => {
      const out = translate(c.input);
      expect(out).toEqual(c.expected);
    });
  }

  test("translate is pure: same input twice yields equal but independent output", () => {
    const input: SmartCrabConfig = {
      providers: [{ id: "a", kind: "openai", envOverrides: { OPENAI_API_KEY: "sk-v" } }],
      priority: [{ providerId: "a", weight: 1 }],
      defaults: { fallbackProviderId: "a", rateLimitBackoffSec: 30 },
    };
    const a = translate(input);
    const b = translate(input);
    expect(a).toEqual(b);
    // mutating api must not corrupt the original input
    const entry = a.providers["a"];
    if (entry && entry.api) {
      const mutable = entry.api as Record<string, string>;
      mutable.key = "mutated";
    }
    expect(input.providers[0]?.envOverrides?.OPENAI_API_KEY).toBe("sk-v");
  });

  test("condition field on PriorityRule is non-functional (not propagated)", () => {
    const out = translate({
      providers: [{ id: "x", kind: "anthropic" }],
      priority: [
        { providerId: "x", weight: 1, condition: "user-flag:beta" },
      ],
      defaults: { fallbackProviderId: "x", rateLimitBackoffSec: 30 },
    });
    const entry = out.providers["x"];
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("condition");
  });
});
