"use client";

import { useState } from "react";
import { Download, FlaskConical, Pause, Play, Settings2 } from "lucide-react";
import type { usePaperAlgo } from "@/lib/algo/usePaperAlgo";
import { PRESETS } from "@/lib/algo/presets";
import { unrealized, validQuote } from "@/lib/algo/engine";
import { price, ticker, type MarketData } from "@/lib/market";
import type { Strategy } from "@/lib/algo/types";
import AlgoDialog from "./AlgoDialog";
import StrategySettings from "./StrategySettings";
import BacktestDrawer from "./BacktestDrawer";

type Controller = ReturnType<typeof usePaperAlgo>;
export default function PaperAlgoDashboard({ algo, data, selectedSymbol, onSymbolChange }: { algo: Controller; data: MarketData; selectedSymbol: string; onSymbolChange: (symbol: string) => void }) {
  const [settings, setSettings] = useState<Strategy | null>(null);
  const [backtestStrategy, setBacktestStrategy] = useState<Strategy | null>(null);
  const [tab, setTab] = useState<"positions" | "ledger">("positions");
  const [filter, setFilter] = useState("");
  const [reset, setReset] = useState(false);
  const [capital, setCapital] = useState(1_000_000);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState("Custom momentum");
  const [minVolume, setMinVolume] = useState(1.5);
  const [minChange, setMinChange] = useState(1);
  const [strategyId, setStrategyId] = useState("");
  const state = algo.state;
  const exits = state?.orders.filter((o) => o.order_type === "EXIT") ?? [];
  const pnl = state?.positions.reduce((sum, p) => {
    const quote = data.stocks.find((q) => q.symbol === p.symbol);
    return sum + unrealized(p, quote?.price ?? p.avg_entry_price);
  }, 0) ?? 0;
  const unmarked = state?.positions.filter((p) => data.stocks.find((q) => q.symbol === p.symbol)?.price == null).length ?? 0;
  const orders = state?.orders.filter((o) => `${o.symbol} ${o.reason} ${o.order_type} ${o.side}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  function exportCsv() {
    const columns = ["executed_at", "symbol", "strategy_id", "side", "order_type", "qty", "executed_price", "fees", "pnl", "reason"] as const;
    const escape = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [columns.join(","), ...orders.map((order) => columns.map((col) => escape(order[col])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "marketpulse-paper-orders.csv"; link.click(); URL.revokeObjectURL(url);
  }
  return <section id="paper-algo" className="mb-6 scroll-mt-28 space-y-5" aria-labelledby="paper-title">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="paper-title" className="text-2xl font-semibold">Paper Algo <span className="text-[#b7f76b]">Lab</span></h2><p className="mt-2 text-xs text-slate-400">Virtual execution only · {algo.mode === "supabase" ? "Supabase persistence" : "Browser-local persistence"} · no real orders</p></div><button disabled={!state || algo.busy} onClick={() => { setCapital(state?.portfolio.initial_capital ?? 1_000_000); setReset(true); }} className="rounded border border-rose-400/40 px-3 py-2 text-xs text-rose-300 disabled:opacity-40">Reset Portfolio</button></header>
    {algo.error && <p role="alert" className="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">{algo.error}</p>}
    {!state ? <p role="status" className="panel p-6 text-sm text-slate-400">{algo.error ? "Portfolio unavailable. Resolve the storage error and reload." : "Loading saved paper portfolio..."}</p> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{[
        ["Virtual Capital", price(state.portfolio.initial_capital)], ["Available Cash", price(state.portfolio.cash_balance)],
        ["Unrealized P&L", unmarked ? "Incomplete marks" : price(pnl)], ["Realized P&L", price(state.portfolio.realized_pnl)],
        ["Win Rate", exits.length ? `${(exits.filter((o) => (o.pnl ?? 0) > 0).length / exits.length * 100).toFixed(1)}%` : "--"],
        ["Portfolio Equity", unmarked ? "Incomplete marks" : price(state.portfolio.cash_balance + state.positions.reduce((s, p) => s + p.avg_entry_price * p.qty, 0) + pnl)],
      ].map(([label, value]) => <div key={label} className="panel p-4"><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-3 font-mono text-lg">{value}</p></div>)}</div>
      <p className="text-xs leading-relaxed text-slate-500">0.05% adverse slippage per fill; INR 20 brokerage per order plus delivery-style STT, stamp and exchange/GST estimates. Shorts reserve 100% collateral and are educational, not a model of overnight cash-equity short eligibility. Gross unrealized P&L excludes future exit fees. Evaluation runs only while this browser is open and fresh quotes arrive; cached observations never trigger fills.</p>
      <div className="flex flex-wrap gap-3"><button onClick={() => setCustom(true)} className="rounded border border-slate-600 px-3 py-2 text-xs">Create custom rule</button><span className="self-center text-xs text-slate-400">{algo.busy ? "Saving portfolio..." : `${state.strategies.filter((s) => s.is_active).length} active strategies`}</span></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{state.strategies.map((strategy) => <article key={strategy.id} className="panel flex flex-col p-5">
        <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{strategy.name}</h3><button disabled={algo.busy} onClick={() => void algo.toggle(strategy.id)} aria-pressed={strategy.is_active} aria-label={`${strategy.is_active ? "Pause" : "Activate"} ${strategy.name}`} className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] disabled:opacity-40 ${strategy.is_active ? "bg-[#283d20] text-[#b7f76b]" : "bg-slate-800 text-slate-400"}`}>{strategy.is_active ? <Play size={11} /> : <Pause size={11} />}{strategy.is_active ? "Active" : "Paused"}</button></div>
        <p className="mb-3 mt-3 min-h-12 text-xs leading-relaxed text-slate-400">{PRESETS.find((p) => p.type === strategy.preset_type)?.description ?? `Volume >=${strategy.params_json.minVolumeRatio ?? 0}x, change >=${strategy.params_json.minChangePercent ?? 0}%`}</p>
        <p className="text-[11px] text-slate-300">SL {strategy.stop_loss_pct}% · Target {strategy.target_pct}% · Allocation {strategy.capital_allocation_pct}%</p><p className="my-2 text-[10px] text-slate-500">Trail {strategy.trailing_sl_pct}% · {strategy.params_json.symbol ?? "All observed stocks"}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-3"><button onClick={() => setSettings(strategy)} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-2 text-xs"><Settings2 size={12} />Customize</button><button onClick={() => setBacktestStrategy(strategy)} className="flex items-center gap-1 rounded border border-[#415d31] px-2 py-2 text-xs text-[#b7f76b]"><FlaskConical size={12} />Run 6M Backtest</button></div>
      </article>)}</div>
      <div className="panel p-5"><h3 className="mb-3 text-sm font-semibold">Paper Trade / Backtest</h3><div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">Symbol<select value={selectedSymbol.endsWith(".NS") ? selectedSymbol : "RELIANCE.NS"} onChange={(e) => onSymbolChange(e.target.value)} className="mt-2 block rounded border border-slate-600 bg-[#161c26] p-2 text-slate-200">{data.stocks.map((q) => <option key={q.symbol}>{q.symbol}</option>)}</select></label>
        <label className="text-xs text-slate-400">Risk settings<select value={strategyId || state.strategies[0]?.id || ""} onChange={(e) => setStrategyId(e.target.value)} className="mt-2 block max-w-64 rounded border border-slate-600 bg-[#161c26] p-2 text-slate-200">{state.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {(["LONG", "SHORT"] as const).map((side) => <button key={side} disabled={algo.busy || !validQuote(data.stocks.find((q) => q.symbol === selectedSymbol))} onClick={() => void algo.manual(selectedSymbol, side, strategyId || state.strategies[0].id)} className="rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-30">Paper {side}</button>)}
        <button onClick={() => setBacktestStrategy(state.strategies.find((s) => s.id === strategyId) ?? state.strategies[0])} className="rounded border border-[#415d31] px-3 py-2 text-xs text-[#b7f76b]">Backtest selected symbol</button>
      </div></div>
      <div className="panel overflow-hidden"><div className="flex flex-wrap gap-3 border-b border-slate-700 p-4"><button onClick={() => setTab("positions")} aria-pressed={tab === "positions"} className={tab === "positions" ? "text-sm text-[#b7f76b]" : "text-sm text-slate-400"}>Open Positions ({state.positions.length})</button><button onClick={() => setTab("ledger")} aria-pressed={tab === "ledger"} className={tab === "ledger" ? "text-sm text-[#b7f76b]" : "text-sm text-slate-400"}>Order Ledger ({state.orders.length})</button></div>
        {tab === "positions" ? <div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-xs"><thead className="text-slate-400"><tr>{["Symbol / Side", "Qty", "Entry", "Stop", "Target", "Unrealized P&L", "Action"].map((c) => <th key={c} className="p-3">{c}</th>)}</tr></thead><tbody>{state.positions.map((p) => {
          const q = data.stocks.find((q) => q.symbol === p.symbol);
          return <tr key={p.id} className="border-t border-slate-800"><td className="p-3">{ticker(p.symbol)} · {p.side}<span className="mt-1 block text-[10px] text-slate-500">{state.strategies.find((s) => s.id === p.strategy_id)?.name}</span></td><td className="p-3">{p.qty}</td><td className="p-3">{price(p.avg_entry_price)}</td><td className="p-3">{price(p.stop_loss_price)}</td><td className="p-3">{price(p.target_price)}</td><td className="p-3">{q?.price == null ? "N/A" : price(unrealized(p, q.price))}{q?.cached && <span className="block text-[10px] text-amber-300">Last session mark</span>}</td><td className="p-3"><button disabled={algo.busy || !validQuote(q)} onClick={() => void algo.squareOff(p.id)} className="rounded border border-rose-400/40 px-2 py-1 text-rose-200 disabled:opacity-30">Square Off</button></td></tr>;
        })}</tbody></table>{!state.positions.length && <p className="p-6 text-center text-sm text-slate-500">No open positions. Activate a strategy to evaluate the next fresh observation.</p>}</div> : <>
          <div className="flex flex-wrap gap-3 p-4"><input aria-label="Filter trade history" placeholder="Filter symbol, reason, side, entry/exit..." value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-60 flex-1 rounded border border-slate-600 bg-[#161c26] p-2 text-xs" /><button onClick={exportCsv} className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-xs"><Download size={12} />Export CSV</button></div>
          <div className="max-h-96 overflow-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-slate-400"><tr>{["Time", "Symbol", "Side / Type", "Qty", "Fill", "Fees", "Net P&L", "Reason"].map((c) => <th key={c} className="p-3">{c}</th>)}</tr></thead><tbody>{[...orders].reverse().map((o) => <tr key={o.id} className="border-t border-slate-800">{[new Date(o.executed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), ticker(o.symbol), `${o.side} / ${o.order_type}`, o.qty, price(o.executed_price), price(o.fees), o.pnl === null ? "--" : price(o.pnl), o.reason].map((cell, i) => <td key={i} className="p-3">{cell}</td>)}</tr>)}</tbody></table>{!orders.length && <p className="p-6 text-center text-sm text-slate-500">No matching orders.</p>}</div>
        </>}
      </div>
    </>}
    {settings && <StrategySettings strategy={settings} onSave={algo.configure} onClose={() => setSettings(null)} />}
    {backtestStrategy && state && <BacktestDrawer strategy={backtestStrategy} initialSymbol={selectedSymbol} capital={state.portfolio.initial_capital} onClose={() => setBacktestStrategy(null)} />}
    {reset && <AlgoDialog title="Reset Portfolio" onClose={() => setReset(false)}><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void algo.reset(capital); setReset(false); }}><p className="text-sm text-rose-200">This clears all positions, orders and strategy settings for this portfolio. No real money is involved.</p><label className="block text-xs">New virtual capital (INR)<input type="number" min={1000} max={1_000_000_000} required value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3" /></label><button className="rounded bg-rose-900 px-4 py-2 text-sm">Confirm reset</button></form></AlgoDialog>}
    {custom && <AlgoDialog title="Create custom rule" onClose={() => setCustom(false)}><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void algo.addCustom(customName, { minVolumeRatio: minVolume, minChangePercent: minChange, side: "LONG" }); setCustom(false); }}><label className="block text-xs">Strategy name<input required maxLength={120} value={customName} onChange={(e) => setCustomName(e.target.value)} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3" /></label><label className="block text-xs">Minimum volume ratio<input type="number" min={0} step=".1" required value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value))} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3" /></label><label className="block text-xs">Minimum change %<input type="number" step=".1" required value={minChange} onChange={(e) => setMinChange(Number(e.target.value))} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3" /></label><p className="text-xs text-slate-400">Creates a paused LONG rule. Customize allocation and risk settings before activation.</p><button className="rounded bg-[#b7f76b] px-4 py-2 text-sm text-black">Create rule</button></form></AlgoDialog>}
  </section>;
}
