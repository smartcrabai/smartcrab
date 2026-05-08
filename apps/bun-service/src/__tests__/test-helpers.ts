import { spyOn } from "bun:test";

/**
 * Silence console.error for the duration of a test suite.
 * Call in beforeEach / afterEach as shown:
 *
 *   const spy = silenceConsoleError();
 *   beforeEach(() => spy.setup());
 *   afterEach(() => spy.restore());
 */
export function silenceConsoleError() {
  let spy: ReturnType<typeof spyOn> | undefined;
  return {
    setup() {
      spy?.mockRestore();
      spy = spyOn(console, "error").mockImplementation(() => {});
    },
    restore() {
      spy?.mockRestore();
      spy = undefined;
    },
  };
}
