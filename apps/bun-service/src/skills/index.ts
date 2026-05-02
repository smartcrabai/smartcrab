/**
 * Public entry point for the skills subsystem.
 */

export * from "./types.ts";
export { SkillsRegistry, buildSkillPrompt } from "./registry.ts";
export type { SkillsDb, SkillsRegistryOptions } from "./registry.ts";
export {
  loadFromDisk,
  defaultSkillsDir,
  mergeIntoRegistry,
  fileBodyResolver,
} from "./loader.ts";
export {
  autoGenerate,
  buildAutoGenPrompt,
  parseAutoGenResponse,
} from "./auto-gen.ts";
