"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortfolio, evaluate, openPosition, squareOff } from "./engine";
import { isAlgoState, PAPER_STORAGE_KEY, readLocal, writeLocal } from "./storage";
import { marketContext, type AlgoState, type Rules, type Side, type Strategy } from "./types";
import type { Candle, MarketData } from "../market";

export function usePaperAlgo(data: MarketData) {
  const [state, setState] = useState<AlgoState | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"local" | "supabase">("local");
  const [busy, setBusy] = useState(false);
  const current = useRef<AlgoState | null>(null);
  const locked = useRef(false);
  const failed = useRef(false);
  const histories = useRef<Record<string, Candle[]>>({});

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const response = await fetch("/api/paper");
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not initialize paper portfolio");
        if (cancelled) return;
        const remote = result.mode === "supabase";
        setMode(remote ? "supabase" : "local");
        let next: AlgoState;
        if (remote && result.state) {
          if (!isAlgoState(result.state)) throw new Error("Cloud portfolio is invalid");
          next = result.state;
        } else if (remote) {
          next = createPortfolio(1_000_000, result.userKey);
          const save = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next, expectedRevision: -1 }) });
          const saved = await save.json();
          if (!save.ok) throw new Error(saved.error ?? "Could not create cloud portfolio");
          next.revision = saved.revision;
        } else next = readLocal(localStorage) ?? createPortfolio();
        if (cancelled) return;
        if (!remote) next = writeLocal(localStorage, next, null);
        else localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(next));
        current.current = next;
        setState(next);
      } catch (e) {
        console.error("[paper] Initialization failed", e);
        if (!cancelled) setError(e instanceof Error ? e.message : "Paper storage unavailable");
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  const commit = useCallback(async (change: (previous: AlgoState) => AlgoState) => {
    if (locked.current || !current.current || failed.current) return false;
    locked.current = true;
    setBusy(true);
    let persisting = false;
    try {
      const task = async () => {
        const previous = current.current!;
        const next = change(previous);
        if (next === previous) return;
        if (!isAlgoState(next)) throw new Error("Invalid portfolio settings or ledger");
        persisting = true;
        let saved: AlgoState;
        if (mode === "supabase") {
          const response = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next, expectedRevision: previous.revision }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Cloud save failed");
          saved = { ...next, revision: result.revision };
          localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(saved));
        } else saved = writeLocal(localStorage, next, previous.revision);
        current.current = saved;
        setState(saved);
        setError("");
      };
      if (navigator.locks) await navigator.locks.request("marketpulse-paper", task);
      else await task();
      return true;
    } catch (e) {
      console.error("[paper] Transaction failed", e);
      failed.current = persisting;
      setError(`${e instanceof Error ? e.message : "Could not save portfolio"}${persisting ? " Trading paused; reload to reconcile saved state." : ""}`);
      return false;
    } finally { locked.current = false; setBusy(false); }
  }, [mode]);

  useEffect(() => {
    if (!state || state.last_evaluated_at === data.fetchedAt || data.snapshotStatus === "unavailable") return;
    let cancelled = false;
    async function run() {
      try {
        if (data.candles.length) histories.current[data.symbol] = data.candles;
        const symbols = [...new Set(state!.strategies.filter((s) => s.is_active && ["ema", "rsi", "squeeze"].includes(s.preset_type)).flatMap((s) => s.params_json.symbol ? [s.params_json.symbol] : []))];
        for (const symbol of symbols) {
          if (histories.current[symbol]?.at(-1)?.time === data.stocks.find((q) => q.symbol === symbol)?.asOf) continue;
          const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&history=true`);
          const result: MarketData = await response.json();
          if (!response.ok || !Array.isArray(result.candles) || !result.candles.length) throw new Error(`Observed history unavailable for ${symbol}; history-based evaluation paused.`);
          histories.current[symbol] = result.candles;
        }
        if (!cancelled) await commit((previous) => evaluate(previous, marketContext(data, histories.current)));
      } catch (e) {
        console.error("[paper] Evaluation failed", e);
        if (!cancelled) setError(e instanceof Error ? e.message : "Paper evaluator unavailable");
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [data, state, commit]);

  return {
    state, error, busy, mode, commit,
    toggle: (id: string) => commit((previous) => ({ ...previous, strategies: previous.strategies.map((s) => s.id === id ? { ...s, is_active: !s.is_active } : s) })),
    configure: (strategy: Strategy) => commit((previous) => ({ ...previous, strategies: previous.strategies.map((s) => s.id === strategy.id ? strategy : s) })),
    reset: (capital: number) => commit((previous) => ({ ...createPortfolio(capital, previous.portfolio.user_key), revision: previous.revision })),
    squareOff: (id: string) => commit((previous) => {
      const p = previous.positions.find((row) => row.id === id);
      return squareOff(previous, id, data.stocks.find((q) => q.symbol === p?.symbol));
    }),
    manual: (symbol: string, side: Side, strategyId: string) => commit((previous) => {
      const quote = data.stocks.find((q) => q.symbol === symbol), strategy = previous.strategies.find((s) => s.id === strategyId);
      if (!quote || !strategy) throw new Error("Select an observed stock and strategy");
      if (previous.positions.some((p) => p.strategy_id === strategyId && p.symbol === symbol)) throw new Error("This strategy already holds that symbol");
      const next = structuredClone(previous);
      const used = next.positions.filter((p) => p.strategy_id === strategyId).reduce((sum, p) => sum + p.avg_entry_price * p.qty + p.entry_fees, 0);
      if (!openPosition(next, strategy, quote, side, next.portfolio.initial_capital * strategy.capital_allocation_pct / 100 - used, new Date().toISOString())) throw new Error("Insufficient cash or strategy allocation for one share");
      return next;
    }),
    addCustom: (name: string, rules: Rules) => commit((previous) => ({
      ...previous, strategies: [...previous.strategies, { ...previous.strategies[0], id: crypto.randomUUID(), name, preset_type: "custom", is_active: false, params_json: rules }],
    })),
  };
}
