import { computeSignal, finite, rangePosition, type Candle, type MarketQuote } from "../market.ts";
import { closePosition, createPortfolio, openPosition, trail, unrealized } from "./engine.ts";
import { entrySide, rotationSector } from "./presets.ts";
import type { HistoricalContext, Strategy } from "./types.ts";

export interface BacktestResult {
  netPnl: number; winRate: number; maxDrawdown: number; profitFactor: number | null; totalTrades: number;
  equityCurve: { time: string; equity: number }[];
  warnings: string[];
}
export interface BacktestMember { instrument: MarketQuote; candles: Candle[] }

function validateCandles(candles: Candle[]) {
  if (candles.length < 22) throw new Error("At least 22 observed daily candles are required");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.open, c.high, c.low, c.close, c.volume].every(finite) || Math.min(c.open, c.low, c.close) <= 0 || c.volume < 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || (i > 0 && c.time <= candles[i - 1].time)) throw new Error("OHLCV candles must be valid, unique and chronological");
  }
}

export function backtestBasket(strategy: Strategy, universe: BacktestMember[], historical: Record<string, HistoricalContext>, capital = 1_000_000): BacktestResult {
  if (strategy.preset_type !== "sector") throw new Error("Basket evaluation requires a sector strategy");
  if (!universe.length) throw new Error("No observed historical sector leaders are available");
  for (const member of universe) validateCandles(member.candles);
  const state = createPortfolio(capital);
  state.strategies = [strategy];
  const sessions = Object.keys(historical).sort();
  const bars = new Map(universe.map((member) => [member.instrument.symbol, new Map(member.candles.map((c) => [c.time, c]))]));
  const marks = new Map<string, number>();
  const curve = sessions.length ? [{ time: sessions[0], equity: capital }] : [];
  for (let i = 1; i < sessions.length; i++) {
    const day = sessions[i], previous = historical[sessions[i - 1]];
    const exited = new Set<string>();
    for (const p of [...state.positions]) {
      const bar = bars.get(p.symbol)?.get(day);
      if (!bar) continue;
      const instrument = universe.find((m) => m.instrument.symbol === p.symbol)!.instrument;
      const sectorExit = (previous.sectorFlows[rotationSector(instrument)] ?? 0) < 0;
      const stop = bar.low <= p.stop_loss_price, target = bar.high >= p.target_price;
      if (sectorExit || stop || target) {
        closePosition(state, p, sectorExit ? bar.open : stop ? Math.min(bar.open, p.stop_loss_price) : Math.max(bar.open, p.target_price), sectorExit ? "Historical sector reversal" : stop ? "Historical basket stop" : "Historical basket target", day);
        exited.add(p.symbol);
      }
    }
    for (const quote of previous.quotes ?? []) {
      if (state.positions.length >= 2) break;
      if (exited.has(quote.symbol) || state.positions.some((p) => p.symbol === quote.symbol)) continue;
      const bar = bars.get(quote.symbol)?.get(day);
      if (!bar || !entrySide(strategy, quote, { ...previous, quotes: previous.quotes ?? [], histories: {}, now: day })) continue;
      const allocation = capital * strategy.capital_allocation_pct / 100;
      const used = state.positions.reduce((sum, p) => sum + p.avg_entry_price * p.qty + p.entry_fees, 0);
      const opened = openPosition(state, strategy, { ...quote, price: bar.open, cached: false }, "LONG", Math.min(allocation - used, allocation / 2), day);
      const p = opened ? state.positions.at(-1) : undefined;
      if (p && (bar.low <= p.stop_loss_price || bar.high >= p.target_price)) closePosition(state, p, bar.low <= p.stop_loss_price ? p.stop_loss_price : p.target_price, "Historical basket entry-day exit (stop first)", day);
    }
    for (const p of [...state.positions]) {
      const bar = bars.get(p.symbol)?.get(day);
      if (bar) {
        marks.set(p.symbol, bar.close);
        trail(p, strategy, bar.high);
        if (i === sessions.length - 1) closePosition(state, p, bar.close, "End of basket backtest", day);
      }
    }
    curve.push({
      time: day,
      equity: state.portfolio.cash_balance + state.positions.reduce((sum, p) => sum + p.avg_entry_price * p.qty + unrealized(p, marks.get(p.symbol) ?? p.avg_entry_price), 0),
    });
  }
  const result = metrics(capital, state.orders.flatMap((o) => o.pnl === null ? [] : [o.pnl]), curve);
  result.netPnl = (curve.at(-1)?.equity ?? capital) - capital;
  result.warnings.push("Historical two-stock basket: daily leaders use only the previous session's observed cross-section; equal capped allocations, next-open fills and stop-first OHLC ambiguity. Fees are estimates.");
  if (state.positions.length) result.warnings.push("Some terminal candles are missing. Unclosed positions are valued at their last observed close; no unavailable-price liquidation is invented.");
  return result;
}

export function metrics(initial: number, pnls: number[], equityCurve: BacktestResult["equityCurve"]): BacktestResult {
  let peak = initial, maxDrawdown = 0;
  for (const point of equityCurve) { peak = Math.max(peak, point.equity); maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak * 100); }
  const gains = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const losses = -pnls.filter((p) => p < 0).reduce((s, p) => s + p, 0);
  return {
    netPnl: pnls.reduce((s, p) => s + p, 0), winRate: pnls.length ? pnls.filter((p) => p > 0).length / pnls.length * 100 : 0,
    maxDrawdown, profitFactor: losses ? gains / losses : gains ? null : 0, totalTrades: pnls.length, equityCurve, warnings: [],
  };
}

export function backtest(strategy: Strategy, instrument: MarketQuote, candles: Candle[], capital = 1_000_000, historical: Record<string, HistoricalContext> = {}): BacktestResult {
  validateCandles(candles);
  const state = createPortfolio(capital);
  state.strategies = [strategy];
  const curve = [{ time: candles[0].time, equity: capital }];
  for (let i = 21; i < candles.length; i++) {
    const bar = candles[i], signalBar = candles[i - 1], prior = candles[i - 2];
    const history = candles.slice(0, i);
    const avg = history.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
    const ratio = avg > 0 ? signalBar.volume / avg : null;
    const change = (signalBar.close / prior.close - 1) * 100;
    const quote: MarketQuote = {
      ...instrument, price: signalBar.close, changePercent: change, volumeRatio: ratio,
      signal: computeSignal(change, ratio), rangePosition: rangePosition(signalBar.close, signalBar.low, signalBar.high),
      observedAt: `${bar.time}T03:45:00.000Z`, asOf: bar.time, cached: false, source: "yahoo",
    };
    const context = historical[signalBar.time] ?? { mood: null, vix: null, sectorFlows: {} };
    let exited = false;
    // Stops in force at the previous close precede any new high/low trail updates.
    for (const p of [...state.positions]) {
      if (strategy.preset_type === "sector" && (context.sectorFlows[rotationSector(quote)] ?? 0) < 0) {
        closePosition(state, p, bar.open, "Historical sector reversal", bar.time); exited = true; continue;
      }
      const stop = p.side === "LONG" ? bar.low <= p.stop_loss_price : bar.high >= p.stop_loss_price;
      const target = p.side === "LONG" ? bar.high >= p.target_price : bar.low <= p.target_price;
      if (stop || target) {
        const fill = stop ? p.side === "LONG" ? Math.min(bar.open, p.stop_loss_price) : Math.max(bar.open, p.stop_loss_price)
          : p.side === "LONG" ? Math.max(bar.open, p.target_price) : Math.min(bar.open, p.target_price);
        closePosition(state, p, fill, stop ? "Historical stop (stop-first ambiguity)" : "Historical target", bar.time);
        exited = true;
      }
    }
    if (!state.positions.length && !exited) {
      const side = strategy.preset_type === "sector" && !context.quotes ? null : entrySide(strategy, quote, {
        ...context, quotes: context.quotes ?? [quote],
        histories: { [quote.symbol]: strategy.preset_type === "squeeze" ? history.slice(0, -1) : history }, now: quote.observedAt!,
      });
      if (side) {
        openPosition(state, strategy, { ...quote, price: bar.open }, side, capital * strategy.capital_allocation_pct / 100 / (strategy.preset_type === "sector" ? 2 : 1), bar.time);
        // A newly opened position is exposed to this day's range as well.
        const p = state.positions[0];
        if (p) {
          const stop = side === "LONG" ? bar.low <= p.stop_loss_price : bar.high >= p.stop_loss_price;
          const target = side === "LONG" ? bar.high >= p.target_price : bar.low <= p.target_price;
          if (stop || target) closePosition(state, p, stop ? p.stop_loss_price : p.target_price, stop ? "Historical entry-day stop" : "Historical entry-day target", bar.time);
        }
      }
    }
    for (const p of state.positions) trail(p, strategy, p.side === "LONG" ? bar.high : bar.low);
    if (i === candles.length - 1) for (const p of [...state.positions]) closePosition(state, p, bar.close, "End of backtest", bar.time);
    const equity = state.portfolio.cash_balance + state.positions.reduce((sum, p) => sum + p.avg_entry_price * p.qty + unrealized(p, bar.close), 0);
    curve.push({ time: bar.time, equity });
  }
  const result = metrics(capital, state.orders.flatMap((o) => o.pnl === null ? [] : [o.pnl]), curve);
  result.warnings.push("Daily OHLCV simulation: signals use completed bars, fills use next open, ambiguous bars hit stop first. Taxes are estimates.");
  if (!Object.keys(historical).length && (["orb", "oi-trend", "rsi"].includes(strategy.preset_type) || strategy.params_json.minMood !== undefined || strategy.params_json.maxVix !== undefined)) result.warnings.push("Historical mood / VIX / rotation are not included in symbol candles. Entries requiring missing context are skipped, not fabricated.");
  if (strategy.preset_type === "sector") result.warnings.push("Single-symbol basket sleeve: requires observed historical sector flow and cross-sectional leader quotes. Missing basket context skips entries; this is not an aggregate two-stock basket return.");
  return result;
}
