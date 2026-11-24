export async function fetchQuoteChunks<T>(
  symbols: readonly string[],
  fetchBatch: (symbols: string[], signal: AbortSignal) => Promise<T[]>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const quotes: T[] = [];
  const failures: { symbols: string[]; reason: unknown }[] = [];
  const unique = [...new Set(symbols)];
  for (let offset = 0; offset < unique.length; offset += 25) {
    if (offset > 0) await wait(250 + Math.floor(Math.random() * 100));
    const chunk = unique.slice(offset, offset + 25);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Quote batch timed out after 10s")); }, 10_000);
    });
    const [result] = await Promise.allSettled([Promise.race([fetchBatch(chunk, controller.signal), timeout])]);
    clearTimeout(timer);
    if (result.status === "fulfilled") quotes.push(...result.value);
    else failures.push({ symbols: chunk, reason: result.reason });
  }
  return { quotes, failures };
}
