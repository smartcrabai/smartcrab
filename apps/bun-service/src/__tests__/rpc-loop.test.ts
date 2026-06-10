import { describe, expect, test } from "bun:test";

import { pumpLines } from "../rpc-loop";

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

const ignoreErrors = (): void => {};

describe("pumpLines", () => {
  test("splits chunks into lines and handles a trailing partial line", async () => {
    const lines: string[] = [];
    await pumpLines(
      streamOf("a\nb", "c\n", "tail"),
      async (line) => {
        lines.push(line);
      },
      ignoreErrors,
    );
    expect(lines).toEqual(["a", "bc", "tail"]);
  });

  test("a slow handler does not block later lines (no head-of-line blocking)", async () => {
    const completed: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const pump = pumpLines(
      streamOf("slow\nfast\n"),
      async (line) => {
        if (line === "slow") await slowGate;
        completed.push(line);
      },
      ignoreErrors,
    );

    // Give the fast handler a chance to finish while "slow" is still pending.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(completed).toEqual(["fast"]);

    releaseSlow();
    await pump;
    expect(completed).toEqual(["fast", "slow"]);
  });

  test("waits for in-flight handlers before resolving", async () => {
    let done = false;
    await pumpLines(
      streamOf("x\n"),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done = true;
      },
      ignoreErrors,
    );
    expect(done).toBe(true);
  });

  test("handler errors are reported and do not stop other lines", async () => {
    const errors: unknown[] = [];
    const handled: string[] = [];
    await pumpLines(
      streamOf("bad\ngood\n"),
      async (line) => {
        if (line === "bad") throw new Error("boom");
        handled.push(line);
      },
      (err) => errors.push(err),
    );
    expect(handled).toEqual(["good"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });

  test("a throwing onError does not break the loop or leak rejections", async () => {
    const handled: string[] = [];
    await pumpLines(
      streamOf("bad\ngood\n"),
      async (line) => {
        if (line === "bad") throw new Error("boom");
        handled.push(line);
      },
      () => {
        throw new Error("reporter exploded");
      },
    );
    expect(handled).toEqual(["good"]);
  });

  test("a stream error is reported and in-flight handlers still drain", async () => {
    const errors: unknown[] = [];
    let done = false;
    // Deliver one chunk, then fail the stream on the next read. (Erroring in
    // start() would discard the queued chunk before it is ever read.)
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode("x\n"));
        } else {
          controller.error(new Error("stream broke"));
        }
      },
    });
    await pumpLines(
      stream,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        done = true;
      },
      (err) => errors.push(err),
    );
    expect(done).toBe(true);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("stream broke");
  });
});
