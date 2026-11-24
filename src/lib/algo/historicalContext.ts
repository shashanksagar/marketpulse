import { buildMoneyRotation, computeMarketMood, INSTRUMENTS, normalizeQuote, ROTATION_INDICES, type Candle, type QuoteInput } from "../market.ts";
import { rotationSector } from "./presets.ts";
import type { HistoricalContext } from "./types.ts";

export function buildHistoricalContexts(histories: Record<string, Candle[]>, sessions: string[]) {
  const inputs = new Map<string, Map<string, QuoteInput>>();
  for (const [symbol, candles] of Object.entries(histories)) {
    const days = new Map<string, QuoteInput>();
    candles.forEach((c, i) => {
      const volumes = candles.slice(Math.max(0, i - 10), i);
      days.set(c.time, {
        symbol, regularMarketPrice: c.close, regularMarketPreviousClose: candles[i - 1]?.close,
        regularMarketOpen: c.open, regularMarketDayHigh: c.high, regularMarketDayLow: c.low, regularMarketVolume: c.volume,
        averageDailyVolume10Day: volumes.length === 10 ? volumes.reduce((sum, row) => sum + row.volume, 0) / 10 : undefined,
        // A daily session label, not a claim about an observed intraday tick time.
        regularMarketTime: new Date(`${c.time}T00:00:00Z`),
      });
    });
    inputs.set(symbol, days);
  }
  const contexts: Record<string, HistoricalContext> = {};
  for (const day of sessions) {
    const quotes = INSTRUMENTS.map((i) => normalizeQuote(i, inputs.get(i.symbol)?.get(day)));
    const stocks = quotes.filter((q) => q.sector !== null);
    const rotation = buildMoneyRotation(ROTATION_INDICES.flatMap((i) => {
      const input = inputs.get(i.symbol)?.get(day);
      if (!input || input.regularMarketPreviousClose === undefined || input.regularMarketPreviousClose <= 0) return [];
      return [{ ...input, regularMarketChangePercent: (input.regularMarketPrice! / input.regularMarketPreviousClose - 1) * 100 }];
    }));
    const vix = inputs.get("^INDIAVIX")?.get(day)?.regularMarketPrice ?? null;
    const mood = computeMarketMood(stocks, quotes[0], { value: vix, source: vix === null ? "unavailable" : "yahoo", asOf: vix === null ? null : day });
    const leader = rotation.arriving[0]?.name;
    const leaders = stocks.filter((q) => q.price !== null && q.changePercent !== null && q.changePercent > 0 && rotationSector(q) === leader)
      .sort((a, b) => b.changePercent! - a.changePercent! || a.symbol.localeCompare(b.symbol)).slice(0, 2);
    contexts[day] = {
      mood: mood.score, vix,
      sectorFlows: Object.fromEntries(rotation.sectors.map((sector) => [sector.name, sector.flowCr])),
      quotes: leaders,
    };
  }
  return contexts;
}
