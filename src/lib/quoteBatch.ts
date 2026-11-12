export async function fetchQuoteChunks<T>(
  symbols: readonly string[],
  fetchBatch: (symbols: string[]) => Promise<T[]>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const quotes: T[] = [];
  const failures: { symbols: string[]; reason: unknown }[] = [];
  const unique = [...new Set(symbols)];
  for (let offset = 0; offset < unique.length; offset += 40) {
    if (offset > 0) await wait(150);
    const chunk = unique.slice(offset, offset + 40);
    const [result] = await Promise.allSettled([fetchBatch(chunk)]);
    if (result.status === "fulfilled") quotes.push(...result.value);
    else failures.push({ symbols: chunk, reason: result.reason });
  }
  return { quotes, failures };
}
