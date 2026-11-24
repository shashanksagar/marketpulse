import type { Candle, MarketData, MarketQuote } from "../market.ts";

export type Side = "LONG" | "SHORT";
export type PresetType = "orb" | "oi-trend" | "ema" | "rsi" | "sector" | "squeeze" | "custom";
export interface Rules {
  minVolumeRatio?: number;
  minRangePosition?: number;
  minChangePercent?: number;
  minMood?: number;
  maxRsi?: number;
  maxVix?: number;
  side?: Side;
  symbol?: string;
}
export interface Strategy {
  id: string; user_key: string; name: string; preset_type: PresetType; is_active: boolean;
  capital_allocation_pct: number; stop_loss_pct: number; target_pct: number; trailing_sl_pct: number;
  params_json: Rules; created_at: string;
}
export interface Portfolio {
  id: string; user_key: string; initial_capital: number; cash_balance: number; realized_pnl: number; created_at: string;
}
export interface Position {
  id: string; portfolio_id: string; strategy_id: string; symbol: string; side: Side; qty: number;
  avg_entry_price: number; stop_loss_price: number; target_price: number; highest_price_seen: number;
  entry_fees: number; last_observed_at: string; opened_at: string;
}
export interface Order {
  id: string; portfolio_id: string; strategy_id: string; symbol: string; side: Side; order_type: "ENTRY" | "EXIT";
  qty: number; executed_price: number; fees: number; pnl: number | null; reason: string; executed_at: string;
}
export interface AlgoState {
  portfolio: Portfolio; strategies: Strategy[]; positions: Position[]; orders: Order[]; revision: number;
  last_evaluated_at: string | null;
  processed_quotes: Record<string, string>;
}
export interface EvaluationContext {
  quotes: MarketQuote[];
  mood: number | null;
  vix: number | null;
  sectorFlows: Partial<Record<string, number>>;
  histories: Record<string, Candle[]>;
  now: string;
}
export type HistoricalContext = Pick<EvaluationContext, "mood" | "vix" | "sectorFlows"> & { quotes?: MarketQuote[] };

export function marketContext(data: MarketData, histories: Record<string, Candle[]> = {}): EvaluationContext {
  return {
    quotes: data.stocks, mood: data.marketMood.score, vix: data.marketMood.indiaVix.value,
    sectorFlows: Object.fromEntries(data.moneyRotation.sectors.map((sector) => [sector.name, sector.flowCr])),
    histories, now: data.fetchedAt,
  };
}
