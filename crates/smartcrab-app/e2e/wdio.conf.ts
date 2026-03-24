import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the debug binary built with `cargo build --features smartcrab-app/webdriver`
// __dirname = <repo>/crates/smartcrab-app/e2e  →  3 levels up = repo root
const APP_BINARY = join(
  __dirname,
  "../../..",
  "target/debug/smartcrab-app",
);

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/**/*.test.ts"],
  maxInstances: 1,
  capabilities: [
    {
      // @ts-expect-error tauri-specific capability
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],
  hostname: "localhost",
  port: 4444,
  path: "/",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    timeout: 30000,
  },
};
