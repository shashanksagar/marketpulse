import { finite } from "../market.ts";
import type { AlgoState } from "./types.ts";

export const PAPER_STORAGE_KEY = "marketpulse.paper.v1";
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = (value: unknown): value is number => finite(value) && value > 0;
const unique = (values: { id: string }[]) => new Set(values.map((v) => v.id)).size === values.length;

export function isAlgoState(value: unknown): value is AlgoState {
  if (!record(value) || !record(value.portfolio) || !Array.isArray(value.strategies) || !Array.isArray(value.positions) || !Array.isArray(value.orders)) return false;
  const p = value.portfolio;
  if (!record(value.processed_quotes) || !Object.entries(value.processed_quotes).every(([key, stamp]) => /^[A-Z0-9&-]+\.NS$/.test(key) && date(stamp))) return false;
  if (!uuid(p.id) || !uuid(p.user_key) || !positive(p.initial_capital) || !finite(p.cash_balance) || !finite(p.realized_pnl) || !date(p.created_at) || !Number.isInteger(value.revision) || (value.last_evaluated_at !== null && !date(value.last_evaluated_at))) return false;
  if (value.strategies.length > 50 || value.positions.length > 1000 || value.orders.length > 20000) return false;
  const strategies = value.strategies;
  if (!strategies.every((s) => record(s) && uuid(s.id) && s.user_key === p.user_key && typeof s.name === "string" && s.name.length > 0 && s.name.length <= 120 && ["orb", "oi-trend", "ema", "rsi", "sector", "squeeze", "custom"].includes(String(s.preset_type)) && typeof s.is_active === "boolean" && positive(s.capital_allocation_pct) && s.capital_allocation_pct <= 100 && positive(s.stop_loss_pct) && s.stop_loss_pct < 100 && positive(s.target_pct) && finite(s.trailing_sl_pct) && s.trailing_sl_pct >= 0 && s.trailing_sl_pct < 100 && record(s.params_json) && Object.entries(s.params_json).every(([k, v]) => k === "symbol" ? typeof v === "string" && /^[A-Z0-9&-]+\.NS$/.test(v) : k === "side" ? v === "LONG" || v === "SHORT" : ["minVolumeRatio", "minRangePosition", "minChangePercent", "minMood", "maxRsi", "maxVix"].includes(k) && finite(v)) && date(s.created_at))) return false;
  const common = (row: unknown): row is Record<string, unknown> => record(row) && uuid(row.id) && row.portfolio_id === p.id && strategies.some((s) => s.id === row.strategy_id) && typeof row.symbol === "string" && /^[A-Z0-9&-]+\.NS$/.test(row.symbol) && ["LONG", "SHORT"].includes(String(row.side)) && finite(row.qty) && Number.isInteger(row.qty) && row.qty > 0;
  if (!value.positions.every((row) => common(row) && positive(row.avg_entry_price) && positive(row.stop_loss_price) && positive(row.target_price) && positive(row.highest_price_seen) && finite(row.entry_fees) && row.entry_fees >= 0 && date(row.last_observed_at) && date(row.opened_at))) return false;
  if (!value.orders.every((row) => common(row) && ["ENTRY", "EXIT"].includes(String(row.order_type)) && positive(row.executed_price) && finite(row.fees) && row.fees >= 0 && (row.pnl === null || finite(row.pnl)) && typeof row.reason === "string" && row.reason.length <= 500 && date(row.executed_at))) return false;
  return unique(strategies) && unique(value.positions) && unique(value.orders);
}

export function readLocal(storage: Pick<Storage, "getItem">): AlgoState | null {
  const raw = storage.getItem(PAPER_STORAGE_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!isAlgoState(value)) throw new Error("Saved paper portfolio is invalid. Export or clear browser storage before starting over.");
  return value;
}

export function writeLocal(storage: Pick<Storage, "getItem" | "setItem">, state: AlgoState, expectedRevision: number | null): AlgoState {
  if (!isAlgoState(state)) throw new Error("Cannot save invalid paper state");
  const saved = readLocal(storage);
  if (expectedRevision !== null && (!saved || saved.revision !== expectedRevision)) throw new Error("Portfolio changed in another tab. Reload before trading.");
  const next = { ...state, revision: expectedRevision === null ? state.revision : expectedRevision + 1 };
  storage.setItem(PAPER_STORAGE_KEY, JSON.stringify(next));
  return next;
}
