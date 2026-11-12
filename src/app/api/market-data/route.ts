import YahooFinance from "yahoo-finance2";
import {
  INSTRUMENTS, ROTATION_INDICES, buildMoneyRotation, computeMarketMood, normalizeQuote, summarize,
  type Candle, type Instrument, type MarketData, type MarketMood, type QuoteInput, type Source,
} from "@/lib/market";
import { fetchQuoteChunks } from "@/lib/quoteBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const TTL = 30 * 60 * 1000;
const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"], versionCheck: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(6000) }),
});
type Snapshot = Omit<MarketData, "symbol" | "quote" | "candles" | "candleSource"> & { quotes: Map<string, MarketData["quote"]> };
let snapshotCache: { value: Snapshot; expires: number } | undefined;
let snapshotPending: Promise<Snapshot> | undefined;
const responses = new Map<string, { value: MarketData; body: string; expires: number }>();
const pending = new Map<string, Promise<MarketData>>();
type HistoryData = { candles: Candle[]; source: "yahoo" | "unavailable"; expires: number; warning?: string };
const historyCache = new Map<string, HistoryData>();

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;

async function loadHistory(instrument: Instrument, refresh: boolean): Promise<HistoryData> {
  const cached = historyCache.get(instrument.symbol);
  if (!refresh && cached && cached.expires > Date.now()) return cached;
  try {
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 6);
    const result = await yahoo.chart(instrument.symbol, { period1: start, interval: "1d" });
    const candles: Candle[] = [];
    for (const row of result.quotes) {
      if (!positive(row.open) || !positive(row.high) || !positive(row.low) || !positive(row.close)) continue;
      if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) continue;
      const time = row.date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      candles.push({ time, open: row.open, high: row.high, low: row.low, close: row.close, volume: finite(row.volume) && row.volume >= 0 ? row.volume : 0 });
    }
    const sorted = [...new Map(candles.map((c) => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
    if (sorted.length < 22) throw new Error(`Insufficient daily candles for ${instrument.symbol}`);
    const value = { candles: sorted, source: "yahoo" as const, expires: Date.now() + TTL };
    historyCache.set(instrument.symbol, value);
    return value;
  } catch (error) {
    const warning = `${instrument.symbol}: Yahoo history unavailable; no synthetic candles will be displayed.`;
    console.warn(`[market-data] ${warning}`, error);
    const value: HistoryData = { candles: [], source: "unavailable", expires: Date.now() + TTL, warning };
    historyCache.set(instrument.symbol, value);
    return value;
  }
}

async function loadSnapshot(): Promise<Snapshot> {
  const warnings: string[] = [];
  const symbols = [...INSTRUMENTS.map((i) => i.symbol), ...ROTATION_INDICES.map((i) => i.symbol), "^INDIAVIX"];
  const result = await fetchQuoteChunks<QuoteInput>(symbols, async (chunk) => {
    const batch = await yahoo.quote(chunk);
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
    const warning = `Quote batch unavailable (${failure.symbols.length} symbols); missing values are N/A.`;
    console.warn(`[market-data] ${warning}`, failure.reason);
    warnings.push(warning);
  }
  const raw = new Map(result.quotes.map((q) => [q.symbol, q]));
  const now = new Date();
  const allQuotes = INSTRUMENTS.map((instrument) => normalizeQuote(instrument, raw.get(instrument.symbol)));
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
  const moneyRotation = buildMoneyRotation(result.quotes);
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
  const indiaVix: MarketMood["indiaVix"] = {
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
    fetchedAt: now.toISOString(), warnings, quotes: new Map(allQuotes.map((q) => [q.symbol, q])),
  };
}

function getSnapshot(refresh: boolean) {
  // Concurrent bypasses share one refresh rather than stampeding Yahoo.
  if (snapshotPending) return snapshotPending;
  if (!refresh && snapshotCache && snapshotCache.expires > Date.now()) return Promise.resolve(snapshotCache.value);
  snapshotPending = loadSnapshot().then((value) => {
    snapshotCache = { value, expires: Date.now() + TTL };
    responses.clear();
    return value;
  }).finally(() => { snapshotPending = undefined; });
  return snapshotPending;
}

async function loadMarketData(instrument: Instrument, refresh: boolean): Promise<MarketData> {
  const [snapshot, history] = await Promise.all([getSnapshot(refresh), loadHistory(instrument, refresh)]);
  const { quotes, ...shared } = snapshot;
  const quote = quotes.get(instrument.symbol);
  if (!quote) throw new Error(`Missing configured symbol ${instrument.symbol}`);
  return {
    ...shared, symbol: instrument.symbol, quote, candles: history.candles, candleSource: history.source,
    warnings: [...snapshot.warnings, ...(history.warning ? [history.warning] : [])],
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "^NSEI").trim().toUpperCase();
  const refresh = params.get("refresh") === "true";
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument) return Response.json({ error: "Unsupported NSE symbol.", symbols: INSTRUMENTS.map((i) => i.symbol) }, { status: 400 });
  const cached = responses.get(symbol);
  if (!refresh && !snapshotPending && cached && cached.expires > Date.now() && cached.value.fetchedAt === snapshotCache?.value.fetchedAt) {
    return new Response(cached.body, { headers: { "Content-Type": "application/json", "X-Market-Cache": "HIT", "Cache-Control": "no-store" } });
  }
  try {
    const key = `${symbol}:${refresh}`;
    let task = pending.get(key);
    if (!task) {
      task = loadMarketData(instrument, refresh).finally(() => { pending.delete(key); });
      pending.set(key, task);
    }
    const data = await task;
    const expires = Math.min(historyCache.get(symbol)?.expires ?? Infinity, snapshotCache?.expires ?? Date.now());
    const body = JSON.stringify(data);
    responses.set(symbol, { value: data, body, expires });
    return new Response(body, { headers: { "Content-Type": "application/json", "X-Market-Cache": refresh ? "REFRESH" : "MISS", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[market-data] Failed to assemble dashboard:", error);
    return Response.json({ error: "Market data could not be assembled. Please retry." }, { status: 503 });
  }
}
