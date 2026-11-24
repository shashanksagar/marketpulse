import YahooFinance from "yahoo-finance2";
import {
  INSTRUMENTS, ROTATION_INDICES, buildMoneyRotation, computeMarketMood, normalizeQuote, summarize,
  type Candle, type Instrument, type MarketData, type MarketMood, type QuoteInput, type Source,
} from "@/lib/market";
import { fetchQuoteChunks } from "@/lib/quoteBatch";
import { readSnapshot, writeSnapshot } from "@/lib/db";
import { browserHeaders, fetchNseQuotes, preserveQuotes, recoverChartQuotes, retry } from "./fallback";
import { buildHistoricalContexts } from "@/lib/algo/historicalContext";

const TTL = 30 * 60 * 1000;
const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"], versionCheck: false,
  fetch: (input, init) => fetch(input, {
    ...init, headers: { ...browserHeaders, ...Object.fromEntries(new Headers(init?.headers)) },
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
  }),
});
type Snapshot = Omit<MarketData, "symbol" | "quote" | "candles" | "candleSource">;
let snapshotCache: { value: Snapshot; expires: number } | undefined;
let snapshotPending: Promise<Snapshot> | undefined;
type HistoryData = { candles: Candle[]; source: "yahoo" | "unavailable"; expires: number; warning?: string; quote?: QuoteInput };
const historyCache = new Map<string, HistoryData>();
const historyPending = new Map<string, Promise<HistoryData>>();

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;

async function loadHistory(instrument: Instrument, refresh: boolean): Promise<HistoryData> {
  const pending = historyPending.get(instrument.symbol);
  if (pending) return pending;
  const task = fetchHistory(instrument, refresh).finally(() => historyPending.delete(instrument.symbol));
  historyPending.set(instrument.symbol, task);
  return task;
}

async function fetchHistory(instrument: Instrument, refresh: boolean): Promise<HistoryData> {
  const cached = historyCache.get(instrument.symbol);
  if (!refresh && cached && cached.expires > Date.now()) return cached;
  try {
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 6);
    const signal = AbortSignal.timeout(10_000);
    const result = await retry(() => yahoo.chart(instrument.symbol, { period1: start, interval: "1d" }, { fetchOptions: { signal } }), signal);
    const candles: Candle[] = [];
    for (const row of result.quotes) {
      if (!positive(row.open) || !positive(row.high) || !positive(row.low) || !positive(row.close)) continue;
      if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) continue;
      const time = row.date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      candles.push({ time, open: row.open, high: row.high, low: row.low, close: row.close, volume: finite(row.volume) && row.volume >= 0 ? row.volume : 0 });
    }

    const sorted = [...new Map(candles.map((c) => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
    if (sorted.length < 22) throw new Error(`Insufficient daily candles for ${instrument.symbol}`);
    const meta = result.meta;
    const last = sorted.at(-1), previous = sorted.at(-2);
    const average = sorted.slice(-11, -1).map((c) => c.volume);
    const marketTime = meta.regularMarketTime instanceof Date && finite(meta.regularMarketTime.getTime())
      ? meta.regularMarketTime
      : last ? new Date(`${last.time}T00:00:00Z`) : undefined;
    const quote = positive(meta.regularMarketPrice) ? {
      symbol: instrument.symbol, provider: "yahoo" as const, regularMarketPrice: meta.regularMarketPrice,
      regularMarketPreviousClose: positive(meta.chartPreviousClose) ? meta.chartPreviousClose : previous?.close,
      regularMarketOpen: last?.open, regularMarketDayHigh: last?.high, regularMarketDayLow: last?.low,
      regularMarketVolume: last?.volume,
      averageDailyVolume10Day: average.length === 10 ? average.reduce((sum, volume) => sum + volume, 0) / 10 : undefined,
      regularMarketTime: marketTime,
    } : undefined;
    const value = { candles: sorted, source: "yahoo" as const, expires: Date.now() + TTL, ...(quote ? { quote } : {}) };
    historyCache.set(instrument.symbol, value);
    return value;
  } catch (error) {
    const warning = `${instrument.symbol}: Yahoo history unavailable; no synthetic candles will be displayed.`;
    console.warn(`[market-data] ${warning}`, error);
    const value: HistoryData = cached?.candles.length
      ? { ...cached, expires: Date.now() + 60_000, warning: `${warning} Last observed history retained.` }
      : { candles: [], source: "unavailable", expires: Date.now() + 60_000, warning };
    historyCache.set(instrument.symbol, value);
    return value;
  }
}

let historicalPending: Promise<Record<string, Candle[]>> | undefined;
async function loadHistoricalUniverse() {
  if (historicalPending) return historicalPending;
  historicalPending = (async () => {
    const instruments = [...new Map([...INSTRUMENTS, ...ROTATION_INDICES.map((i) => ({ ...i, sector: null })), { symbol: "^INDIAVIX", name: "India VIX", sector: null }].map((i) => [i.symbol, i])).values()];
    const histories: Record<string, Candle[]> = {};
    let cursor = 0;
    const deadline = Date.now() + 120_000;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < instruments.length && Date.now() < deadline) {
        const instrument = instruments[cursor++];
        const cached = historyCache.get(instrument.symbol);
        const data = await loadHistory(instrument, false);
        if (data.candles.length) histories[instrument.symbol] = data.candles;
        if (cursor < instruments.length && (!cached || cached.expires <= Date.now())) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }));
    return histories;
  })().finally(() => { historicalPending = undefined; });
  return historicalPending;
}

export async function getBacktestContext(symbol: string) {
  const histories = await loadHistoricalUniverse();
  const selected = histories[symbol];
  if (!selected?.length) throw new Error("Selected symbol history unavailable");
  const contexts = buildHistoricalContexts(histories, selected.map((c) => c.time));
  const leaders = new Set(Object.values(contexts).flatMap((c) => c.quotes?.map((q) => q.symbol) ?? []));
  const universe = INSTRUMENTS.filter((i) => leaders.has(i.symbol) && histories[i.symbol]?.length)
    .map((i) => ({ instrument: normalizeQuote(i), candles: histories[i.symbol] }));
  const missing = [...INSTRUMENTS, ...ROTATION_INDICES, { symbol: "^INDIAVIX" }].filter((i) => !histories[i.symbol]).map((i) => i.symbol);
  return {
    contexts, universe,
    warnings: [
      "Historical mood uses observed daily breadth, NIFTY and VIX. Historical rotation uses observed sector-index returns and the same labeled volume-weight model as the dashboard.",
      ...(missing.length ? [`History missing for ${missing.length} instruments; available observations form the historical sample. Missing required inputs skip entries.`] : []),
    ],
  };
}

export async function getInstrumentHistory(instrument: Instrument) {
  const history = await loadHistory(instrument, false);
  const snapshot = snapshotCache?.value ?? await readSnapshot();
  const quote = [...(snapshot?.stocks ?? []), ...(snapshot?.indices ?? [])].find((q) => q.symbol === instrument.symbol) ?? normalizeQuote(instrument);
  return {
    symbol: instrument.symbol, quote, candles: history.candles, candleSource: history.source,
    warnings: history.warning ? [history.warning] : [],
  };
}

async function loadSnapshot(): Promise<Snapshot> {
  const warnings: string[] = [];
  let cookieFailure = false;
  const symbols = [...INSTRUMENTS.map((i) => i.symbol), ...ROTATION_INDICES.map((i) => i.symbol), "^INDIAVIX"];
  const result = await fetchQuoteChunks<QuoteInput>(symbols, async (chunk, signal) => {
    if (cookieFailure) throw new Error("Yahoo cookie handshake unavailable; chart fallback will recover observations");
    const batch = await retry(() => yahoo.quote(chunk, {}, { fetchOptions: { signal } }), signal).catch((error: unknown) => {
      if (error instanceof Error && /cookie|crumb/i.test(error.message)) cookieFailure = true;
      throw error;
    });
    return batch.flatMap((q): QuoteInput[] => typeof q.symbol === "string" ? [{
      symbol: q.symbol,
      regularMarketPrice: finite(q.regularMarketPrice) ? q.regularMarketPrice : undefined,
      regularMarketPreviousClose: finite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : undefined,
      regularMarketChange: finite(q.regularMarketChange) ? q.regularMarketChange : undefined,
      regularMarketChangePercent: finite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : undefined,
      regularMarketOpen: finite(q.regularMarketOpen) ? q.regularMarketOpen : undefined,
      regularMarketDayHigh: finite(q.regularMarketDayHigh) ? q.regularMarketDayHigh : undefined,
      regularMarketDayLow: finite(q.regularMarketDayLow) ? q.regularMarketDayLow : undefined,
      regularMarketVolume: finite(q.regularMarketVolume) ? q.regularMarketVolume : undefined,
      averageDailyVolume10Day: finite(q.averageDailyVolume10Day) ? q.averageDailyVolume10Day : undefined,
      averageDailyVolume3Month: finite(q.averageDailyVolume3Month) ? q.averageDailyVolume3Month : undefined,
      regularMarketTime: q.regularMarketTime instanceof Date ? q.regularMarketTime : undefined,
    }] : []);
  });
  for (const failure of result.failures) {
    const warning = `Quote batch unavailable (${failure.symbols.length} symbols); retaining last observed prices where available.`;
    console.warn(`[market-data] ${warning}`, failure.reason instanceof Error ? failure.reason.message : failure.reason);
    warnings.push(warning);
  }
  const raw = new Map(result.quotes.map((q) => [q.symbol, q]));
  const missing = symbols.filter((symbol) => !positive(raw.get(symbol)?.regularMarketPrice));
  if (missing.length) {
    try {
      for (const q of await fetchNseQuotes(missing, AbortSignal.timeout(10_000))) raw.set(q.symbol, q);
    } catch (error) {
      console.warn("[market-data] NSE fallback unavailable", error);
      warnings.push("NSE fallback unavailable; retaining persisted observations.");
    }
    const instruments = new Map([...INSTRUMENTS, ...ROTATION_INDICES.map((i) => ({ ...i, sector: null })), { symbol: "^INDIAVIX", name: "India VIX", sector: null }].map((i) => [i.symbol, i]));
    const recovered = await recoverChartQuotes(missing.filter((s) => !positive(raw.get(s)?.regularMarketPrice)), async (symbol) => {
      const instrument = instruments.get(symbol);
      if (!instrument) throw new Error(`Unsupported recovery symbol ${symbol}`);
      const history = await loadHistory(instrument, false);
      const quote = history.quote;
      if (!quote?.regularMarketTime || !positive(quote.regularMarketPrice)) throw new Error(`Chart metadata unavailable for ${symbol}`);
      return {
        meta: { regularMarketPrice: quote.regularMarketPrice, regularMarketTime: quote.regularMarketTime },
        quotes: history.candles.map((c) => ({ ...c, date: new Date(`${c.time}T00:00:00Z`) })),
      };
    });
    for (const q of recovered.quotes) raw.set(q.symbol, q);
    if (recovered.quotes.length) warnings.push(`${recovered.quotes.length} quotes recovered from observed Yahoo chart metadata.`);
    if (recovered.failures.length) warnings.push(`${recovered.failures.length} chart recoveries unavailable; last observed quotes retained where available.`);
  }
  const now = new Date();
  const previous = snapshotCache?.value ?? await readSnapshot();
  const allQuotes = preserveQuotes(INSTRUMENTS.map((instrument) => {
    const q = normalizeQuote(instrument, raw.get(instrument.symbol));
    return q.price !== null && (!q.observedAt || now.getTime() - Date.parse(q.observedAt) > 30 * 60_000) ? { ...q, cached: true } : q;
  }), [...(previous?.stocks ?? []), ...(previous?.indices ?? [])]);
  const stocks = allQuotes.filter((q) => q.sector !== null);
  const indices = allQuotes.filter((q) => q.sector === null);
  const coverage = {
    total: stocks.length, observed: stocks.filter((q) => q.price !== null).length,
    unavailable: stocks.filter((q) => q.price === null).length, mixed: stocks.filter((q) => q.source === "mixed").length,
  };
  if (coverage.unavailable || coverage.mixed) {
    const warning = `F&O coverage: ${coverage.unavailable} unavailable and ${coverage.mixed} partial quotes out of ${coverage.total}. Missing fields display N/A.`;
    console.warn(`[market-data] ${warning}`);
    warnings.push(warning);
  }
  const rotation = buildMoneyRotation([...raw.values()]);
  const moneyRotation = rotation.sectors.length ? rotation : previous?.moneyRotation ?? rotation;
  for (const node of moneyRotation.unavailable) {
    const warning = `${node.symbol}: rotation change unavailable; omitted from flow estimates.`;
    console.warn(`[market-data] ${warning}`);
    warnings.push(warning);
  }
  for (const node of moneyRotation.sectors) {
    if (!node.fallbackFields.length) continue;
    const warning = `${node.symbol}: rotation uses illustrative ${node.fallbackFields.join(", ")} fallback.`;
    console.warn(`[market-data] ${warning}`);
    warnings.push(warning);
  }
  const vix = raw.get("^INDIAVIX");
  const vixDate = vix?.regularMarketTime;
  const vixValue = vix?.regularMarketPrice;
  const vixReal = positive(vixValue);
  const indiaVix: MarketMood["indiaVix"] = !vixReal && previous ? previous.marketMood.indiaVix : {
    value: vixReal ? vixValue : null,
    source: vixReal ? vixDate instanceof Date && finite(vixDate.getTime()) ? "yahoo" : "mixed" : "unavailable",
    asOf: vixReal && vixDate instanceof Date && finite(vixDate.getTime()) ? vixDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null,
  };
  if (indiaVix.source !== "yahoo") {
    const warning = `India VIX ${indiaVix.source === "unavailable" ? "unavailable; VIX and mood score display N/A" : "session date unavailable"}.`;
    console.warn(`[market-data] ${warning}`);
    warnings.push(warning);
  }
  const marketMood = computeMarketMood(stocks, indices[0], indiaVix);
  const sources = [...allQuotes.map((q) => q.source), moneyRotation.source, marketMood.source];
  const source: Source = sources.every((s) => s === "yahoo") ? "yahoo" : sources.every((s) => s === "unavailable") ? "unavailable" : "mixed";
  return {
    stocks, indices, ...summarize(stocks), moneyRotation, marketMood, coverage, source,
    fetchedAt: [...raw.values()].some((q) => positive(q.regularMarketPrice)) ? now.toISOString() : previous?.fetchedAt ?? now.toISOString(),
    warnings, snapshotStatus: allQuotes.some((q) => q.cached) ? "cached" : coverage.observed ? "fresh" : "unavailable",
  };
}

export function refreshSnapshot() {
  // Concurrent bypasses share one refresh rather than stampeding Yahoo.
  if (snapshotPending) return snapshotPending;
  snapshotPending = loadSnapshot().then((value) => {
    snapshotCache = { value, expires: Date.now() + TTL };
    return writeSnapshot(value).then(() => value);
  }).finally(() => { snapshotPending = undefined; });
  return snapshotPending;
}

export async function getMarketData(instrument: Instrument, refresh: boolean, background: (task: () => Promise<void>) => void, requireHistory = false): Promise<MarketData> {
  if (!snapshotCache) {
    const stored = await readSnapshot();
    if (stored) snapshotCache = { value: { ...stored, snapshotStatus: "cached", stocks: stored.stocks.map((q) => ({ ...q, cached: true })), indices: stored.indices.map((q) => ({ ...q, cached: true })) }, expires: 0 };
  }
  const needsRefresh = refresh || !snapshotCache || snapshotCache.expires <= Date.now();
  const saved = snapshotCache?.value;
  const snapshot = saved && needsRefresh ? {
    ...saved, snapshotStatus: "cached" as const,
    stocks: saved.stocks.map((q) => ({ ...q, cached: true })), indices: saved.indices.map((q) => ({ ...q, cached: true })),
  } : saved ?? await refreshSnapshot();
  const cachedHistory = historyCache.get(instrument.symbol);
  const history = requireHistory ? await loadHistory(instrument, refresh) : cachedHistory ?? { candles: [], source: "unavailable" as const, expires: 0 };
  if (saved && needsRefresh || !cachedHistory || cachedHistory.expires <= Date.now()) background(async () => {
    await Promise.all([saved && needsRefresh ? refreshSnapshot() : Promise.resolve(), loadHistory(instrument, refresh)]);
  });
  const quote = [...snapshot.stocks, ...snapshot.indices].find((q) => q.symbol === instrument.symbol);
  if (!quote) throw new Error(`Missing configured symbol ${instrument.symbol}`);
  return {
    ...snapshot, symbol: instrument.symbol, quote, candles: history.candles, candleSource: history.source,
    warnings: [...snapshot.warnings, ...(history.warning ? [history.warning] : [])],
  };
}
