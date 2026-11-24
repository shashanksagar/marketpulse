"use client";

import { useState } from "react";
import { FNO_STOCKS } from "@/data/fnoStocks";
import { backtest, backtestBasket, type BacktestMember, type BacktestResult } from "@/lib/algo/backtester";
import type { HistoricalContext, Strategy } from "@/lib/algo/types";
import { price, type MarketData } from "@/lib/market";
import AlgoDialog from "./AlgoDialog";

export default function BacktestDrawer({ strategy, initialSymbol, capital, onClose }: { strategy: Strategy; initialSymbol: string; capital: number; onClose: () => void }) {
  const [symbol, setSymbol] = useState(initialSymbol.endsWith(".NS") ? initialSymbol : "RELIANCE.NS");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&history=true`);
      const data: Pick<MarketData, "quote" | "candles"> & { error?: string; candleSource?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load observed candles");
      if (data.candleSource !== "yahoo") throw new Error("Observed Yahoo candles are unavailable; no synthetic history is used.");
      const needsContext = ["orb", "oi-trend", "rsi", "sector"].includes(strategy.preset_type) || strategy.params_json.minMood !== undefined || strategy.params_json.maxVix !== undefined;
      let context: { contexts: Record<string, HistoricalContext>; universe: BacktestMember[]; warnings: string[] } = { contexts: {}, universe: [], warnings: [] };
      if (needsContext) {
        const macroResponse = await fetch(`/api/algo/backtest-data?symbol=${encodeURIComponent(symbol)}`);
        const macro = await macroResponse.json();
        if (!macroResponse.ok) throw new Error(macro.error ?? "Could not load historical market context");
        context = macro;
      }
      const result = strategy.preset_type === "sector" ? backtestBasket(strategy, context.universe, context.contexts, capital)
        : backtest({ ...strategy, params_json: { ...strategy.params_json, symbol } }, data.quote, data.candles, capital, context.contexts);
      result.warnings.push(...context.warnings);
      setResult(result);
    } catch (e) { console.error("[backtest] Failed", e); setError(e instanceof Error ? e.message : "Backtest failed"); }
    finally { setBusy(false); }
  }
  const points = result?.equityCurve ?? [];
  const min = Math.min(capital, ...points.map((p) => p.equity)), max = Math.max(capital, ...points.map((p) => p.equity));
  const path = points.map((point, i) => `${20 + i / Math.max(1, points.length - 1) * 560},${180 - (point.equity - min) / Math.max(1, max - min) * 150}`).join(" ");
  return <AlgoDialog title="Run 6M Backtest" onClose={onClose} drawer>
    <p className="mb-4 text-sm text-slate-400">{strategy.name} · INR {price(capital)} initial capital</p>
    <label className="block text-xs">Backtest symbol<select value={symbol} onChange={(e) => { setSymbol(e.target.value); setResult(null); }} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3">{FNO_STOCKS.map((s) => <option key={s.symbol}>{s.symbol}</option>)}</select></label>
    <button onClick={() => void run()} disabled={busy} className="my-4 rounded bg-[#b7f76b] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy ? "Loading observed history and context..." : "Run backtest"}</button>
    <p className="mb-4 text-xs text-slate-500">Macro presets load six months of observed market-wide history on demand (first run can take up to two minutes). Basket runs cover both leaders across historical sector rotations; the selected symbol supplies the session calendar.</p>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {result && <>
      <div className="grid grid-cols-2 gap-3">{[
        ["Net P&L", `INR ${price(result.netPnl)}`], ["Win Rate", `${result.winRate.toFixed(2)}%`],
        ["Max Drawdown", `${result.maxDrawdown.toFixed(2)}%`], ["Profit Factor", result.profitFactor === null ? "No losing trades" : result.profitFactor.toFixed(2)],
        ["Total Trades", String(result.totalTrades)], ["Observed sessions", String(points.length)],
      ].map(([label, value]) => <div key={label} className="rounded border border-slate-700 p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 font-mono">{value}</p></div>)}</div>
      <figure className="my-5 rounded border border-slate-700 p-3"><figcaption className="text-xs text-slate-400">Equity curve · {points[0]?.time} to {points.at(-1)?.time}</figcaption><svg viewBox="0 0 600 210" role="img" aria-label="Historical paper portfolio equity curve"><line x1="20" y1="180" x2="580" y2="180" stroke="#334155" /><polyline points={path} fill="none" stroke="#b7f76b" strokeWidth="2" /></svg><div className="flex justify-between font-mono text-xs text-slate-400"><span>Low {price(min)}</span><span>High {price(max)}</span></div></figure>
      {result.warnings.map((warning) => <p key={warning} className="mb-3 text-xs leading-relaxed text-amber-200/80">{warning}</p>)}
      {!result.totalTrades && <p role="status" className="text-sm text-slate-300">No qualifying trades. Missing historical inputs are not replaced with current-day values.</p>}
    </>}
    <p className="mt-5 text-xs leading-relaxed text-slate-500">Daily candles cannot reproduce intraday ORB or exchange execution. This is an educational simulation, not a prediction or brokerage statement.</p>
  </AlgoDialog>;
}
