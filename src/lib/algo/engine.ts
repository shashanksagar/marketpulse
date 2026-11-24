import { finite, type MarketQuote } from "../market.ts";
import { createStrategies, entrySide, rotationSector } from "./presets.ts";
import type { AlgoState, EvaluationContext, Position, Side, Strategy } from "./types.ts";

const money = (value: number) => Math.round(value * 100) / 100;
export const slippedPrice = (price: number, buy: boolean) => money(price * (buy ? 1.0005 : .9995));
// Educational delivery-style estimate: brokerage, exchange/SEBI, STT, GST and buy-side stamp duty.
export function fees(notional: number, buy: boolean) {
  const brokerage = 20;
  const exchange = notional * .0000322;
  return money(brokerage + notional * .001 + exchange + (brokerage + exchange) * .18 + (buy ? notional * .00015 : 0));
}

export function createPortfolio(capital = 1_000_000, userKey = crypto.randomUUID()): AlgoState {
  if (!finite(capital) || capital < 1000 || capital > 1_000_000_000) throw new Error("Capital must be between INR 1,000 and 1 billion");
  return {
    portfolio: { id: crypto.randomUUID(), user_key: userKey, initial_capital: capital, cash_balance: capital, realized_pnl: 0, created_at: new Date().toISOString() },
    strategies: createStrategies(userKey), positions: [], orders: [], revision: 0, last_evaluated_at: null, processed_quotes: {},
  };
}

export function validQuote(quote: MarketQuote | undefined): quote is MarketQuote & { price: number } {
  return !!quote && finite(quote.price) && quote.price > 0 && quote.source !== "unavailable" && !quote.cached && !!quote.observedAt && Number.isFinite(Date.parse(quote.observedAt));
}

export function unrealized(position: Position, mark: number) {
  return (mark - position.avg_entry_price) * position.qty * (position.side === "LONG" ? 1 : -1);
}

export function openPosition(state: AlgoState, strategy: Strategy, quote: MarketQuote, side: Side, budget: number, now: string) {
  if (!validQuote(quote)) throw new Error("A fresh observed quote is required for a paper fill");
  if (![strategy.stop_loss_pct, strategy.target_pct].every((n) => finite(n) && n > 0 && n < 100) || !finite(strategy.trailing_sl_pct) || strategy.trailing_sl_pct < 0 || strategy.trailing_sl_pct >= 100) throw new Error("Invalid strategy risk settings");
  if (!finite(budget) || budget <= 0) return false;
  const execution = slippedPrice(quote.price, side === "LONG");
  const available = Math.min(budget, state.portfolio.cash_balance);
  let qty = Math.floor(Math.max(0, available - 25) / (execution * 1.002));
  while (qty > 0 && execution * qty + fees(execution * qty, side === "LONG") > available) qty--;
  if (qty < 1) return false;
  const charge = fees(execution * qty, side === "LONG");
  const direction = side === "LONG" ? 1 : -1;
  const position: Position = {
    id: crypto.randomUUID(), portfolio_id: state.portfolio.id, strategy_id: strategy.id, symbol: quote.symbol, side, qty,
    avg_entry_price: execution, stop_loss_price: execution * (1 - direction * strategy.stop_loss_pct / 100),
    target_price: execution * (1 + direction * strategy.target_pct / 100), highest_price_seen: execution,
    entry_fees: charge, opened_at: now, last_observed_at: quote.observedAt!,
  };
  state.positions.push(position);
  state.portfolio.cash_balance = money(state.portfolio.cash_balance - execution * qty - charge);
  state.orders.push({
    id: crypto.randomUUID(), portfolio_id: state.portfolio.id, strategy_id: strategy.id, symbol: quote.symbol, side,
    order_type: "ENTRY", qty, executed_price: execution, fees: charge, pnl: null, reason: `${strategy.name}: entry`, executed_at: now,
  });
  return true;
}

export function closePosition(state: AlgoState, position: Position, observedPrice: number, reason: string, now: string) {
  if (!finite(observedPrice) || observedPrice <= 0) throw new Error("Invalid square-off price");
  if (!state.positions.some((p) => p.id === position.id)) throw new Error("Position is already closed");
  const execution = slippedPrice(observedPrice, position.side === "SHORT");
  const charge = fees(execution * position.qty, position.side === "SHORT");
  const gross = unrealized(position, execution);
  const pnl = money(gross - position.entry_fees - charge);
  // Shorts reserve 100% collateral; sale proceeds are never spendable capital.
  state.portfolio.cash_balance = money(state.portfolio.cash_balance + position.avg_entry_price * position.qty + gross - charge);
  state.portfolio.realized_pnl = money(state.portfolio.realized_pnl + pnl);
  state.positions = state.positions.filter((p) => p.id !== position.id);
  state.orders.push({
    id: crypto.randomUUID(), portfolio_id: state.portfolio.id, strategy_id: position.strategy_id, symbol: position.symbol,
    side: position.side, order_type: "EXIT", qty: position.qty, executed_price: execution, fees: charge, pnl, reason, executed_at: now,
  });
}

export function trail(position: Position, strategy: Strategy, mark: number) {
  if (position.side === "LONG") {
    position.highest_price_seen = Math.max(position.highest_price_seen, mark);
    if (strategy.trailing_sl_pct > 0) position.stop_loss_price = Math.max(position.stop_loss_price, position.highest_price_seen * (1 - strategy.trailing_sl_pct / 100));
  } else {
    position.highest_price_seen = Math.min(position.highest_price_seen, mark);
    if (strategy.trailing_sl_pct > 0) position.stop_loss_price = Math.min(position.stop_loss_price, position.highest_price_seen * (1 + strategy.trailing_sl_pct / 100));
  }
}

export function evaluate(state: AlgoState, context: EvaluationContext): AlgoState {
  if (!Number.isFinite(Date.parse(context.now))) throw new Error("Invalid observation time");
  if (state.last_evaluated_at && Date.parse(context.now) <= Date.parse(state.last_evaluated_at)) return state;
  const next = structuredClone(state);
  const exited = new Set<string>();
  const quotes = new Map(context.quotes.map((q) => [q.symbol, q]));
  for (const position of [...next.positions]) {
    const q = quotes.get(position.symbol);
    if (!validQuote(q) || Date.parse(q.observedAt!) <= Date.parse(position.last_observed_at)) continue;
    const strategy = next.strategies.find((s) => s.id === position.strategy_id);
    if (!strategy) throw new Error("Open position has no strategy");
    const stop = position.side === "LONG" ? q.price <= position.stop_loss_price : q.price >= position.stop_loss_price;
    const target = position.side === "LONG" ? q.price >= position.target_price : q.price <= position.target_price;
    const sectorExit = strategy.preset_type === "sector" && (context.sectorFlows[rotationSector(q)] ?? 0) < 0;
    if (stop || target || sectorExit) {
      closePosition(next, position, q.price, stop ? "Stop / trailing stop" : target ? "Target" : "Sector momentum flipped negative", context.now);
      exited.add(`${position.strategy_id}:${position.symbol}`);
    } else {
      trail(position, strategy, q.price);
      position.last_observed_at = q.observedAt!;
    }
  }
  for (const strategy of next.strategies.filter((s) => s.is_active)) {
    const allocation = next.portfolio.initial_capital * strategy.capital_allocation_pct / 100;
    let used = next.positions.filter((p) => p.strategy_id === strategy.id).reduce((sum, p) => sum + p.avg_entry_price * p.qty + p.entry_fees, 0);
    const candidates = [...context.quotes].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
    for (const q of candidates) {
      if (strategy.preset_type === "sector" && next.positions.filter((p) => p.strategy_id === strategy.id).length >= 2) break;
      if (!validQuote(q) || (state.processed_quotes[q.symbol] && Date.parse(q.observedAt!) <= Date.parse(state.processed_quotes[q.symbol])) || exited.has(`${strategy.id}:${q.symbol}`) || next.positions.some((p) => p.strategy_id === strategy.id && p.symbol === q.symbol)) continue;
      const side = entrySide(strategy, q, context);
      if (!side) continue;
      const budget = Math.min(allocation - used, strategy.preset_type === "sector" ? allocation / 2 : allocation);
      const before = next.portfolio.cash_balance;
      openPosition(next, strategy, q, side, budget, context.now);
      used += before - next.portfolio.cash_balance;
    }
  }
  next.last_evaluated_at = context.now;
  for (const q of context.quotes) if (validQuote(q) && (!next.processed_quotes[q.symbol] || Date.parse(q.observedAt!) > Date.parse(next.processed_quotes[q.symbol]))) next.processed_quotes[q.symbol] = q.observedAt!;
  return next;
}

export function squareOff(state: AlgoState, id: string, quote: MarketQuote | undefined): AlgoState {
  if (!validQuote(quote)) throw new Error("Cannot square off without a fresh observed quote");
  const next = structuredClone(state);
  const position = next.positions.find((p) => p.id === id);
  if (!position || position.symbol !== quote.symbol) throw new Error("Position not found");
  closePosition(next, position, quote.price, "Manual square off", new Date().toISOString());
  return next;
}
