/**
 * NDJSON stream helper shared by the seher-bridge clients (`router.ts` run
 * mode, `auth.commands.ts` login/status flows).
 */

/** Stream NDJSON lines out of a byte stream, yielding one decoded line at a time. */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) yield line;
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
