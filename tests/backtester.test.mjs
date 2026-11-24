import assert from "node:assert/strict";
import test from "node:test";
import { backtest, backtestBasket, metrics } from "../src/lib/algo/backtester.ts";
import { buildHistoricalContexts } from "../src/lib/algo/historicalContext.ts";
import { createPortfolio } from "../src/lib/algo/engine.ts";
import { ema, rsi } from "../src/lib/algo/indicators.ts";
import { INSTRUMENTS, normalizeQuote } from "../src/lib/market.ts";

// Deterministic OHLCV fixtures are test-only, never used by live market-data code.
const candles = Array.from({ length: 130 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 4, i + 1)).toISOString().slice(0, 10),
  open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000,
}));
const quote = normalizeQuote(INSTRUMENTS.find((i) => i.symbol === "RELIANCE.NS"));
const strategy = () => ({ ...createPortfolio().strategies[0], preset_type: "custom", params_json: { minVolumeRatio: .5, minChangePercent: 0 }, capital_allocation_pct: 100, stop_loss_pct: 10, target_pct: 2 });

test("metrics calculate realized net P&L, win rate, peak-to-trough drawdown and profit factor exactly", () => {
  const m = metrics(1000, [100, -50, 0, 200], [{ time: "1", equity: 1100 }, { time: "2", equity: 880 }, { time: "3", equity: 1250 }]);
  assert.equal(m.netPnl, 250); assert.equal(m.winRate, 50); assert.equal(m.maxDrawdown, 20);
  assert.equal(m.profitFactor, 6); assert.equal(m.totalTrades, 4);
  assert.equal(metrics(100, [], []).profitFactor, 0);
  assert.equal(metrics(100, [10], []).profitFactor, null);
});

test("six-month daily backtest produces net-of-friction trades and reconciled equity", () => {
  const result = backtest(strategy(), quote, candles, 100000);
  assert.ok(result.totalTrades > 0);
  assert.ok(result.netPnl > 0);
  assert.ok(result.winRate > 0 && result.winRate <= 100);
  assert.ok(Math.abs(result.equityCurve.at(-1).equity - 100000 - result.netPnl) < .05);
  assert.deepEqual(result.equityCurve.map((p) => p.time), [...result.equityCurve.map((p) => p.time)].sort());
  assert.ok(result.warnings.some((w) => w.includes("next open")));
});

test("no lookahead: changing future candles cannot change prior equity; invalid candles are rejected", () => {
  const baseline = backtest(strategy(), quote, candles, 100000);
  const changed = candles.map((c, i) => i < 100 ? c : { ...c, open: c.open * 2, high: c.high * 2, low: c.low * 2, close: c.close * 2 });
  const result = backtest(strategy(), quote, changed, 100000);
  assert.deepEqual(result.equityCurve.filter((p) => p.time < candles[100].time), baseline.equityCurve.filter((p) => p.time < candles[100].time));
  assert.throws(() => backtest(strategy(), quote, candles.slice(0, 5)), /22/);
  assert.throws(() => backtest(strategy(), quote, [...candles].reverse()), /chronological/);
});

test("context-dependent presets skip unknown historical mood, VIX and sector flow rather than using today's values", () => {
  for (const preset of ["orb", "oi-trend", "rsi", "sector"]) {
    const result = backtest({ ...strategy(), preset_type: preset }, quote, candles);
    assert.equal(result.totalTrades, 0);
    assert.equal(result.netPnl, 0);
    assert.ok(result.warnings.length >= 2);
  }
});

test("EMA warmup and Wilder RSI handle flat, falling and rising histories", () => {
  assert.deepEqual(ema([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.equal(rsi(Array(20).fill(100)), 50);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1)), 100);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 100 - i)), 0);
  assert.equal(rsi([100]), null);
});

test("historical macro contexts use only same-session observed candles, never future market inputs", () => {
  const histories = { "RELIANCE.NS": candles, "^NSEI": candles, "^INDIAVIX": candles.map((c) => ({ ...c, open: 15, close: 15, low: 14, high: 16 })), "^CNXENERGY": candles };
  const days = candles.map((c) => c.time);
  const baseline = buildHistoricalContexts(histories, days);
  assert.equal(baseline[days[40]].vix, 15);
  assert.ok(baseline[days[40]].mood >= 55);
  assert.ok(baseline[days[40]].sectorFlows.Energy > 0);
  assert.equal(baseline[days[40]].quotes[0].symbol, "RELIANCE.NS");
  const changed = { ...histories, "^NSEI": candles.map((c, i) => i <= 50 ? c : { ...c, close: 1 }) };
  assert.deepEqual(buildHistoricalContexts(changed, days.slice(0, 51)), Object.fromEntries(days.slice(0, 51).map((day) => [day, baseline[day]])));
});

test("historical sector basket executes two previous-session leaders and reports aggregate returns", () => {
  const histories = { "RELIANCE.NS": candles, "ONGC.NS": candles.map((c) => ({ ...c, close: c.close + .1 })), "^NSEI": candles, "^CNXENERGY": candles };
  const contexts = buildHistoricalContexts(histories, candles.map((c) => c.time));
  const result = backtestBasket(
    { ...strategy(), preset_type: "sector" },
    ["RELIANCE.NS", "ONGC.NS"].map((symbol) => ({ instrument: normalizeQuote(INSTRUMENTS.find((i) => i.symbol === symbol)), candles: histories[symbol] })),
    contexts, 100000,
  );
  assert.ok(result.totalTrades > 2);
  assert.ok(result.netPnl > 0);
  assert.ok(Math.abs(result.equityCurve.at(-1).equity - 100000 - result.netPnl) < .02);
  assert.ok(result.warnings[0].includes("two-stock basket"));
});
