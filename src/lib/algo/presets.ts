import { finite, type MarketQuote, type Sector } from "../market.ts";
import { ema, rsi } from "./indicators.ts";
import type { EvaluationContext, PresetType, Side, Strategy } from "./types.ts";

export const PRESETS: { type: PresetType; name: string; description: string; sl: number; target: number; trailing: number }[] = [
  { type: "orb", name: "High-Volume ORB / Momentum", description: "2x volume, top 20% of range, +1.5%, mood >=55. Daily momentum proxy, not intraday ORB.", sl: 1.5, target: 3, trailing: 0 },
  { type: "oi-trend", name: "Smart Money OI Buildup", description: "Simulated long/short buildup aligned with arriving/leaving sector; volume >=1.5x.", sl: 1.5, target: 3, trailing: 0 },
  { type: "ema", name: "20/50 EMA Golden Crossover", description: "Confirmed 20 EMA crosses above 50 EMA, volume >=1.2x.", sl: 2, target: 5, trailing: 0 },
  { type: "rsi", name: "RSI Oversold Nifty Rebound", description: "RSI(14) below 30 and observed India VIX below 20.", sl: 2, target: 4, trailing: 0 },
  { type: "sector", name: "Sector Rotation Leader Basket", description: "Equal allocations to the top two momentum names in the leading arriving sector.", sl: 2, target: 5, trailing: 0 },
  { type: "squeeze", name: "Short Covering Squeeze", description: "Simulated short covering above previous session high; trailing stop 1.5%.", sl: 1.5, target: 4, trailing: 1.5 },
];

export function createStrategies(userKey: string): Strategy[] {
  return PRESETS.map((preset) => ({
    id: crypto.randomUUID(), user_key: userKey, name: preset.name, preset_type: preset.type, is_active: false,
    capital_allocation_pct: 15, stop_loss_pct: preset.sl, target_pct: preset.target, trailing_sl_pct: preset.trailing,
    params_json: ["ema", "rsi", "squeeze"].includes(preset.type) ? { symbol: "RELIANCE.NS" } : {}, created_at: new Date().toISOString(),
  }));
}

const sectorMap: Partial<Record<Sector, string>> = { Financials: "Banking", "Capital Goods": "Infra", Realty: "Infra", Telecom: "Infra", Consumer: "FMCG" };
export const rotationSector = (q: MarketQuote) => q.sector ? sectorMap[q.sector] ?? q.sector : "";

export function entrySide(strategy: Strategy, quote: MarketQuote, context: EvaluationContext): Side | null {
  const { volumeRatio: volume, rangePosition: range, changePercent: change } = quote;
  if (strategy.params_json.symbol && strategy.params_json.symbol !== quote.symbol) return null;
  const candles = (context.histories[quote.symbol] ?? []).filter((c) => c.time < (quote.asOf ?? context.now.slice(0, 10)));
  const closes = candles.map((c) => c.close);
  const flow = context.sectorFlows[rotationSector(quote)];
  switch (strategy.preset_type) {
    case "orb": return finite(volume) && volume >= 2 && finite(range) && range >= .8 && finite(change) && change >= 1.5 && finite(context.mood) && context.mood >= 55 ? "LONG" : null;
    case "oi-trend":
      if (!finite(volume) || volume < 1.5 || !finite(flow)) return null;
      return quote.signal === "Long Buildup" && flow > 0 ? "LONG" : quote.signal === "Short Buildup" && flow < 0 ? "SHORT" : null;
    case "ema": {
      if (!finite(volume) || volume < 1.2 || closes.length < 51) return null;
      const fast = ema(closes, 20), slow = ema(closes, 50), n = closes.length - 1;
      const f0 = fast[n - 1], s0 = slow[n - 1], f1 = fast[n], s1 = slow[n];
      return f0 !== null && s0 !== null && f1 !== null && s1 !== null && f0 <= s0 && f1 > s1 ? "LONG" : null;
    }
    case "rsi": {
      const value = rsi(closes);
      return value !== null && value < 30 && finite(context.vix) && context.vix < 20 ? "LONG" : null;
    }
    case "sector": {
      const leader = Object.entries(context.sectorFlows).filter(([, value]) => finite(value) && value > 0).sort((a, b) => b[1]! - a[1]!)[0]?.[0];
      const candidates = context.quotes.filter((q) => rotationSector(q) === leader && finite(q.price) && !q.cached && finite(q.changePercent) && q.changePercent > 0)
        .sort((a, b) => b.changePercent! - a.changePercent! || a.symbol.localeCompare(b.symbol)).slice(0, 2);
      return leader && candidates.some((q) => q.symbol === quote.symbol) ? "LONG" : null;
    }
    case "squeeze":
      return quote.signal === "Short Covering" && candles.length > 0 && finite(quote.price) && quote.price > candles[candles.length - 1].high ? "LONG" : null;
    case "custom": {
      const r = strategy.params_json;
      if (r.minVolumeRatio !== undefined && (!finite(volume) || volume < r.minVolumeRatio)) return null;
      if (r.minRangePosition !== undefined && (!finite(range) || range < r.minRangePosition)) return null;
      if (r.minChangePercent !== undefined && (!finite(change) || change < r.minChangePercent)) return null;
      if (r.minMood !== undefined && (!finite(context.mood) || context.mood < r.minMood)) return null;
      if (r.maxVix !== undefined && (!finite(context.vix) || context.vix >= r.maxVix)) return null;
      if (r.maxRsi !== undefined) { const value = rsi(closes); if (value === null || value >= r.maxRsi) return null; }
      return r.side ?? "LONG";
    }
  }
}
