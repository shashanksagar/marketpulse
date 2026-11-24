import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolio, evaluate, fees, openPosition, closePosition, slippedPrice, squareOff } from "../src/lib/algo/engine.ts";
import { entrySide } from "../src/lib/algo/presets.ts";
import { isAlgoState, readLocal, writeLocal } from "../src/lib/algo/storage.ts";
import { INSTRUMENTS, normalizeQuote } from "../src/lib/market.ts";

const stamp = "2026-11-24T05:00:00.000Z";
const quote = (price = 100, observedAt = stamp) => ({
  ...normalizeQuote(INSTRUMENTS.find((i) => i.symbol === "RELIANCE.NS"), { symbol: "RELIANCE.NS", regularMarketPrice: price, regularMarketTime: new Date(observedAt) }),
  volumeRatio: 2, rangePosition: .8, changePercent: 1.5, signal: "Long Buildup",
});
const context = (q, now = q.observedAt) => ({ quotes: [q], mood: 55, vix: 19, sectorFlows: { Energy: 10 }, histories: {}, now });
const setup = (preset = "orb") => {
  const state = createPortfolio();
  const strategy = state.strategies.find((s) => s.preset_type === preset);
  strategy.is_active = true; strategy.params_json = {};
  return { state, strategy };
};
const near = (a, b) => assert.ok(Math.abs(a - b) < .02, `${a} vs ${b}`);

test("ORB entry boundaries, fee math, allocation, idempotency and net target P&L", () => {
  const { state, strategy } = setup();
  const q = quote();
  assert.equal(entrySide(strategy, q, context(q)), "LONG");
  assert.equal(entrySide(strategy, { ...q, volumeRatio: 1.99 }, context(q)), null);
  assert.equal(entrySide(strategy, q, { ...context(q), mood: null }), null);
  const entered = evaluate(state, context(q));
  assert.equal(state.positions.length, 0);
  assert.equal(entered.positions.length, 1);
  const p = entered.positions[0], entry = entered.orders[0];
  assert.equal(p.avg_entry_price, 100.05);
  assert.equal(entry.fees, fees(p.qty * 100.05, true));
  assert.ok(p.qty * 100.05 + entry.fees <= 150000);
  assert.equal(evaluate(entered, context(q)), entered);
  assert.equal(evaluate({ ...entered, last_evaluated_at: "2026-11-24T05:00:00+00:00" }, context(q)).orders.length, 1);
  assert.equal(evaluate(entered, context(q, "2026-11-24T05:05:00.000Z")).orders.length, 1);
  const exited = evaluate(entered, context(quote(105, "2026-11-24T05:15:00.000Z")));
  assert.equal(exited.positions.length, 0);
  assert.equal(exited.orders.length, 2);
  const exit = exited.orders[1];
  const expected = (slippedPrice(105, false) - 100.05) * p.qty - entry.fees - exit.fees;
  near(exit.pnl, expected);
  near(exited.portfolio.cash_balance, 1_000_000 + exit.pnl);
  near(exited.portfolio.realized_pnl, exit.pnl);
});

test("stop losses and trailing stops exit paused strategies before any new entry", () => {
  const { state, strategy } = setup();
  strategy.target_pct = 30; strategy.trailing_sl_pct = 1.5;
  const entered = evaluate(state, context(quote()));
  const raised = evaluate(entered, context(quote(110, "2026-11-24T05:15:00.000Z")));
  near(raised.positions[0].stop_loss_price, 108.35);
  raised.strategies.find((s) => s.id === strategy.id).is_active = false;
  const stopped = evaluate(raised, context(quote(107, "2026-11-24T05:30:00.000Z")));
  assert.equal(stopped.positions.length, 0);
  assert.match(stopped.orders.at(-1).reason, /Stop/);
  const loss = evaluate(entered, context(quote(95, "2026-11-24T05:15:00.000Z")));
  assert.ok(loss.orders.at(-1).pnl < 0);
});

test("null, cached, undated and unavailable quotes never execute; delayed observations deduplicate by provider time", () => {
  const { state } = setup();
  for (const bad of [{ price: null }, { price: NaN }, { source: "unavailable" }, { cached: true }, { observedAt: null }]) {
    assert.equal(evaluate(state, context({ ...quote(), ...bad }, stamp)).orders.length, 0);
  }
  const first = evaluate(state, context(quote(), "2026-11-24T05:15:00.000Z"));
  const delayed = evaluate(first, context(quote(105, "2026-11-24T05:10:00.000Z"), "2026-11-24T05:25:00.000Z"));
  assert.equal(delayed.positions.length, 0);
  assert.throws(() => squareOff(first, first.positions[0].id, { ...quote(), cached: true }), /fresh/);
});

test("SHORT fills reserve collateral and adverse slippage on both sides; no sale proceeds are recycled", () => {
  const { state, strategy } = setup("oi-trend");
  const q = { ...quote(), changePercent: -2, signal: "Short Buildup" };
  const c = { ...context(q), sectorFlows: { Energy: -10 } };
  assert.equal(entrySide(strategy, q, c), "SHORT");
  const next = evaluate(state, c), p = next.positions[0];
  assert.equal(p.side, "SHORT");
  assert.equal(p.avg_entry_price, 99.95);
  assert.ok(next.portfolio.cash_balance < state.portfolio.cash_balance);
  closePosition(next, p, 95, "Test close", "2026-11-24T06:00:00Z");
  assert.equal(next.orders.at(-1).executed_price, 95.05);
  near(next.portfolio.cash_balance, 1_000_000 + next.portfolio.realized_pnl);
});

test("sector basket splits allocation into two leaders and rotates out on negative flow", () => {
  const { state, strategy } = setup("sector");
  const quotes = [quote(), { ...quote(), symbol: "ONGC.NS", changePercent: 2 }, { ...quote(), symbol: "OIL.NS", changePercent: .5 }];
  const c = { ...context(quotes[0]), quotes };
  const entered = evaluate(state, c);
  assert.equal(entered.positions.length, 2);
  for (const p of entered.positions) assert.ok(p.qty * p.avg_entry_price + p.entry_fees <= state.portfolio.initial_capital * strategy.capital_allocation_pct / 200);
  const exits = evaluate(entered, { ...c, quotes: quotes.map((q) => ({ ...q, observedAt: "2026-11-24T05:30:00.000Z" })), now: "2026-11-24T05:30:00.000Z", sectorFlows: { Energy: -1 } });
  assert.equal(exits.positions.length, 0);
});

test("local adapter persists full state and rejects lost-update conflicts and malformed data", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const { state, strategy } = setup();
  openPosition(state, strategy, quote(), "LONG", 100000, stamp);
  assert.equal(isAlgoState(state), true);
  writeLocal(storage, state, null);
  const saved = writeLocal(storage, state, 0);
  assert.deepEqual(readLocal(storage), saved);
  assert.equal(saved.revision, 1);
  assert.throws(() => writeLocal(storage, state, 0), /another tab/);
  assert.equal(isAlgoState({ ...state, positions: [{ ...state.positions[0], qty: -1 }] }), false);
  storage.setItem("marketpulse.paper.v1", "{}");
  assert.throws(() => readLocal(storage), /invalid/);
});
