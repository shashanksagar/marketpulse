"use client";

import { useState } from "react";
import { FNO_STOCKS } from "@/data/fnoStocks";
import type { Strategy } from "@/lib/algo/types";
import AlgoDialog from "./AlgoDialog";

export default function StrategySettings({ strategy, onSave, onClose }: { strategy: Strategy; onSave: (s: Strategy) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState(strategy);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const historyBased = ["ema", "rsi", "squeeze"].includes(draft.preset_type);
  return <AlgoDialog title="Customize strategy" onClose={onClose}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (historyBased && !draft.params_json.symbol) { setError("Choose a symbol for this history-based strategy."); return; }
      setBusy(true);
      try { if (await onSave(draft)) onClose(); else setError("Strategy was not saved. Check the portfolio storage error."); } catch (e) { setError(e instanceof Error ? e.message : "Could not save strategy"); }
      finally { setBusy(false); }
    }} className="space-y-4">
      <p className="text-sm text-slate-300">{strategy.name}</p>
      {(["stop_loss_pct", "target_pct", "trailing_sl_pct", "capital_allocation_pct"] as const).map((field) => <label key={field} className="block text-xs capitalize text-slate-400">{field.replaceAll("_", " ").replace("pct", "%")}<input type="number" step=".1" min={field === "trailing_sl_pct" ? 0 : .1} max={field === "capital_allocation_pct" ? 100 : 99} required value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: Number(e.target.value) })} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3 text-slate-100" /></label>)}
      <label className="block text-xs text-slate-400">Symbol scope<select value={draft.params_json.symbol ?? ""} onChange={(e) => {
        const params = { ...draft.params_json }; if (e.target.value) params.symbol = e.target.value; else delete params.symbol;
        setDraft({ ...draft, params_json: params });
      }} className="mt-2 w-full rounded border border-slate-600 bg-[#161c26] p-3 text-slate-100">{!historyBased && <option value="">All observed F&O stocks</option>}{FNO_STOCKS.map((s) => <option key={s.symbol}>{s.symbol}</option>)}</select></label>
      <p className="text-xs text-slate-500">Allocation is a cap across all positions of this strategy, including entry fees. Existing positions retain their entry SL/target; trailing settings apply on subsequent fresh observations.</p>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <button disabled={busy} className="rounded bg-[#b7f76b] px-4 py-2 text-sm text-black disabled:opacity-40">Save strategy</button>
    </form>
  </AlgoDialog>;
}
