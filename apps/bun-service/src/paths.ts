/**
 * XDG Base Directory paths for smartcrab.
 *
 * The macOS GUI app runs sandboxed, so `homedir()` resolves to
 * `~/Library/Containers/<bundle-id>/Data/` and these paths are confined to
 * the app container at runtime.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const APP = "smartcrab";

function xdgBase(envVar: string, fallback: string): string {
  const root = process.env[envVar] || join(homedir(), fallback);
  return join(root, APP);
}

export function configDir(): string {
  return xdgBase("XDG_CONFIG_HOME", ".config");
}

export function dataDir(): string {
  return xdgBase("XDG_DATA_HOME", join(".local", "share"));
}
