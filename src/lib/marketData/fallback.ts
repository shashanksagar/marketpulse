import type { MarketQuote, QuoteInput } from "../market.ts";

export const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json,text/html,*/*",
  "Accept-Language": "en-IN,en;q=0.9",
};

export async function retry<T>(task: () => Promise<T>, signal: AbortSignal, wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await task(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || signal.aborted || !/429|rate|crumb|cookie|fetch|network|timeout|ECONN|5\d\d/i.test(message)) throw error;
      await wait(400 * 2 ** attempt + Math.floor(Math.random() * 150));
    }
  }
}

export function preserveQuotes(fresh: MarketQuote[], previous: MarketQuote[] = []) {
  const old = new Map(previous.map((q) => [q.symbol, q]));
  return fresh.map((q) => {
    const saved = old.get(q.symbol);
    const older = saved?.observedAt && (!q.observedAt || Date.parse(q.observedAt) < Date.parse(saved.observedAt));
    return (q.price === null || older) && saved?.price != null ? { ...saved, cached: true } : q;
  });
}

interface ChartObservation {
  meta: { regularMarketPrice: number; regularMarketTime: Date };
  quotes: { close: number | null; open: number | null; high: number | null; low: number | null; volume?: number | null; date: Date }[];
}

export async function recoverChartQuotes(
  symbols: string[], fetchChart: (symbol: string, signal: AbortSignal) => Promise<ChartObservation>,
  signal: AbortSignal = AbortSignal.timeout(110_000),
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  const quotes: QuoteInput[] = [];
  const failures: string[] = [];
  let cursor = 0;
  const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const worker = async () => {
    while (cursor < symbols.length && !signal.aborted) {
      const symbol = symbols[cursor++];
      try {
        const chart = await fetchChart(symbol, AbortSignal.any([signal, AbortSignal.timeout(6000)]));
        const rows = chart.quotes.filter((r) => number(r.close) && r.close > 0).sort((a, b) => a.date.getTime() - b.date.getTime());
        const last = rows.at(-1), previous = rows.at(-2);
        const volumes = rows.slice(-11, -1).map((r) => r.volume).filter((v): v is number => number(v) && v >= 0);
        if (number(chart.meta.regularMarketPrice) && chart.meta.regularMarketPrice > 0) quotes.push({
          symbol, regularMarketPrice: chart.meta.regularMarketPrice, regularMarketTime: chart.meta.regularMarketTime,
          regularMarketPreviousClose: previous?.close ?? undefined,
          regularMarketChangePercent: previous?.close && previous.close > 0
            ? (chart.meta.regularMarketPrice - previous.close) / previous.close * 100
            : undefined,
          regularMarketOpen: last?.open ?? undefined, regularMarketDayHigh: last?.high ?? undefined, regularMarketDayLow: last?.low ?? undefined,
          regularMarketVolume: last?.volume ?? undefined,
          averageDailyVolume10Day: volumes.length === 10 ? volumes.reduce((sum, v) => sum + v, 0) / 10 : undefined,
        });
        else failures.push(symbol);
      } catch (error) {
        failures.push(symbol);
        if (!signal.aborted) console.warn(`[market-data] ${symbol} chart fallback: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (cursor < symbols.length && !signal.aborted) await wait(250 + Math.floor(Math.random() * 100));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, symbols.length) }, worker));
  failures.push(...symbols.slice(cursor));
  return { quotes, failures };
}

export async function fetchNseQuotes(symbols: string[], signal: AbortSignal): Promise<QuoteInput[]> {
  const wanted = new Set(symbols.filter((s) => s.endsWith(".NS")));
  if (!wanted.size) return [];
  const home = await fetch("https://www.nseindia.com", { headers: browserHeaders, signal, cache: "no-store" });
  if (!home.ok) throw new Error(`NSE warm-up HTTP ${home.status}`);
  const cookie = home.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await home.body?.cancel();
  const response = await fetch("https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O", {
    headers: { ...browserHeaders, Cookie: cookie, Referer: "https://www.nseindia.com/" }, signal, cache: "no-store",
  });
  if (!response.ok) throw new Error(`NSE quote HTTP ${response.status}`);
  const payload: { timestamp?: string; data?: { symbol?: string; lastPrice?: number; previousClose?: number; open?: number; dayHigh?: number; dayLow?: number; totalTradedVolume?: number; lastUpdateTime?: string }[] } = await response.json();
  return (payload.data ?? []).flatMap((row): QuoteInput[] => {
    const stamp = row.lastUpdateTime ?? payload.timestamp;
    const symbol = `${row.symbol}.NS`;
    const date = stamp ? new Date(`${stamp.replace(/-/g, " ")} GMT+0530`) : undefined;
    return wanted.has(symbol) && typeof row.lastPrice === "number" && row.lastPrice > 0 && date && Number.isFinite(date.getTime())
      ? [{ symbol, provider: "nse", regularMarketPrice: row.lastPrice, regularMarketPreviousClose: row.previousClose, regularMarketOpen: row.open, regularMarketDayHigh: row.dayHigh, regularMarketDayLow: row.dayLow, regularMarketVolume: row.totalTradedVolume, regularMarketTime: date }] : [];
  });
}
