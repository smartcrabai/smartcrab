import { readLines } from "./seher/ndjson";

/**
 * Line-pumping loop for the stdio JSON-RPC server.
 *
 * Reads newline-delimited lines via `readLines` and hands each one to
 * `handle`. Lines are dispatched concurrently — a slow handler (e.g.
 * chat.bubble-send waiting on an LLM response, or chat.start connecting to
 * Discord) must not head-of-line-block fast requests like pipeline.list.
 * Clients match responses by id, so out-of-order completion is fine.
 *
 * Resolves once the stream has ended AND every in-flight handler has settled.
 * Stream and handler errors are reported through `onError`; neither stops the
 * remaining in-flight handlers from draining.
 */
export async function pumpLines(
  stream: ReadableStream<Uint8Array>,
  handle: (line: string) => Promise<void>,
  onError: (err: unknown) => void,
): Promise<void> {
  const report = (err: unknown): void => {
    try {
      onError(err);
    } catch {
      // Error reporting must never take down the loop or leak a rejection.
    }
  };

  const inFlight = new Set<Promise<void>>();
  try {
    for await (const line of readLines(stream)) {
      const p = handle(line).catch(report);
      inFlight.add(p);
      void p.finally(() => inFlight.delete(p));
    }
  } catch (err) {
    report(err);
  } finally {
    await Promise.allSettled(inFlight);
  }
}
