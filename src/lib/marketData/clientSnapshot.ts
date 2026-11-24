import { computeMarketMood, summarize, type MarketData } from "../market.ts";
import { preserveQuotes } from "./fallback.ts";

export const SNAPSHOT_KEY = "marketpulse.snapshot.v1";
export function isMarketData(value: unknown): value is MarketData {
  if (!value || typeof value !== "object") return false;
  const q = value as Partial<MarketData>;
  return typeof q.symbol === "string" && typeof q.fetchedAt === "string" && Number.isFinite(Date.parse(q.fetchedAt))
    && Array.isArray(q.stocks) && Array.isArray(q.indices) && Array.isArray(q.candles) && !!q.quote && !!q.coverage && !!q.moneyRotation && !!q.marketMood
    && [...q.stocks, ...q.indices].every((quote) => typeof quote.symbol === "string" && (quote.price === null || typeof quote.price === "number" && Number.isFinite(quote.price) && quote.price > 0));
}

export function cachedData(saved: MarketData, symbol: string): MarketData {
  const stocks = saved.stocks.map((q) => ({ ...q, cached: true }));
  const indices = saved.indices.map((q) => ({ ...q, cached: true }));
  const quote = [...stocks, ...indices].find((q) => q.symbol === symbol);
  if (!quote) throw new Error("Saved snapshot does not contain selected symbol");
  return { ...saved, stocks, indices, quote, symbol, snapshotStatus: "cached", candles: saved.symbol === symbol ? saved.candles : [], candleSource: saved.symbol === symbol ? saved.candleSource : "unavailable" };
}

export function mergeMarketData(fresh: MarketData, previous: MarketData | null): MarketData {
  if (!previous || !previous.stocks.some((q) => q.price !== null)) return fresh;
  if (!fresh.stocks.some((q) => q.price !== null)) return cachedData(previous, fresh.symbol);
  const stocks = preserveQuotes(fresh.stocks, previous.stocks), indices = preserveQuotes(fresh.indices, previous.indices);
  const quote = [...stocks, ...indices].find((q) => q.symbol === fresh.symbol) ?? fresh.quote;
  const hasCached = [...stocks, ...indices].some((q) => q.cached);
  return {
    ...fresh, stocks, indices, quote, ...summarize(stocks), snapshotStatus: hasCached ? "cached" : fresh.snapshotStatus,
    marketMood: computeMarketMood(stocks, indices[0], fresh.marketMood.indiaVix.value === null ? previous.marketMood.indiaVix : fresh.marketMood.indiaVix),
    moneyRotation: fresh.moneyRotation.sectors.length ? fresh.moneyRotation : previous.moneyRotation,
    coverage: { total: stocks.length, observed: stocks.filter((q) => q.price !== null).length, unavailable: stocks.filter((q) => q.price === null).length, mixed: stocks.filter((q) => q.source === "mixed").length },
    candles: fresh.candles.length || fresh.symbol !== previous.symbol ? fresh.candles : previous.candles,
    candleSource: fresh.candles.length || fresh.symbol !== previous.symbol ? fresh.candleSource : previous.candleSource,
  };
}
