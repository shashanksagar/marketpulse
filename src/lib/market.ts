import { FNO_STOCKS, STOCK_SECTORS, type StockSector } from "../data/fnoStocks.ts";

export type Signal = "Long Buildup" | "Short Covering" | "Short Buildup" | "Long Unwinding" | "Neutral";
export type Source = "yahoo" | "mixed" | "unavailable";
export type RotationSector = "Banking" | "IT" | "Auto" | "Energy" | "FMCG" | "Pharma" | "Metals" | "Infra";
export type Sector = StockSector;
export interface Instrument { symbol: string; name: string; sector: Sector | null }
export const INDEX_INSTRUMENTS: readonly Instrument[] = [
  { symbol: "^NSEI", name: "NIFTY 50", sector: null },
  { symbol: "^NSEBANK", name: "BANK NIFTY", sector: null },
  { symbol: "^CNXIT", name: "NIFTY IT", sector: null },
];
export const INSTRUMENTS: readonly Instrument[] = [...INDEX_INSTRUMENTS, ...FNO_STOCKS];
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }
export interface MarketQuote {
  symbol: string;
  name: string;
  sector: Sector | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  averageVolume: number | null;
  avgVolume: number | null;
  volumeRatio: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  rangePosition: number | null;
  signal: Signal | null;
  source: Source;
  asOf: string | null;
  missingFields: string[];
}
export interface MarketData {
  symbol: string;
  quote: MarketQuote;
  candles: Candle[];
  candleSource: "yahoo" | "unavailable";
  indices: MarketQuote[];
  stocks: MarketQuote[];
  breadth: { advances: number; declines: number; unchanged: number };
  sectors: { name: Sector; change: number | null; count: number }[];
  moneyRotation: MoneyRotationData;
  marketMood: MarketMood;
  coverage: { total: number; observed: number; unavailable: number; mixed: number };
  source: Source;
  fetchedAt: string;
  warnings: string[];
}
export const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
export const price = (value: number | null) => finite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "N/A";
export const percent = (value: number | null) => finite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "N/A";
export const decimal = (value: number | null, digits = 2, suffix = "") => finite(value) ? `${value.toFixed(digits)}${suffix}` : "N/A";
export const ticker = (symbol: string) => symbol.replace(".NS", "").replace("^", "");

export function computeSignal(change: number | null, ratio: number | null): Signal | null {
  if (!finite(change) || !finite(ratio)) return null;
  if (change === 0 || ratio <= 0) return "Neutral";
  return change >= 0 ? ratio >= 1 ? "Long Buildup" : "Short Covering" : ratio >= 1 ? "Short Buildup" : "Long Unwinding";
}
export function rangePosition(value: number, low: number, high: number) {
  return high > low ? clamp((value - low) / (high - low), 0, 1) : 0.5;
}
export function summarize(stocks: MarketQuote[]) {
  const observed = stocks.filter((q) => finite(q.price) && finite(q.changePercent));
  const breadth = {
    advances: observed.filter((q) => q.changePercent !== null && q.changePercent > 0).length,
    declines: observed.filter((q) => q.changePercent !== null && q.changePercent < 0).length,
    unchanged: observed.filter((q) => q.changePercent === 0).length,
  };
  const sectors = STOCK_SECTORS.map((name) => {
    const members = observed.filter((q) => q.sector === name);
    return { name, change: members.length ? members.reduce((sum, q) => sum + (q.changePercent ?? 0), 0) / members.length : null, count: members.length };
  });
  return { breadth, sectors };
}
export interface QuoteInput {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  averageDailyVolume10Day?: number;
  averageDailyVolume3Month?: number;
  regularMarketTime?: Date;
}
export function normalizeQuote(instrument: Instrument, input?: QuoteInput): MarketQuote {
  const value = positive(input?.regularMarketPrice) ? input.regularMarketPrice : null;
  const previous = input?.regularMarketPreviousClose;
  const change = value === null ? null : finite(input?.regularMarketChange) ? input.regularMarketChange : positive(previous) ? value - previous : null;
  const changePercent = value === null ? null : finite(input?.regularMarketChangePercent) ? input.regularMarketChangePercent : positive(previous) ? (value - previous) / previous * 100 : null;
  const open = value !== null && positive(input?.regularMarketOpen) ? input.regularMarketOpen : null;
  const inputHigh = input?.regularMarketDayHigh, inputLow = input?.regularMarketDayLow;
  const validRange = value !== null && positive(inputHigh) && positive(inputLow) && inputHigh >= inputLow;
  const high = validRange ? inputHigh : null, low = validRange ? inputLow : null;
  const volume = value !== null && finite(input?.regularMarketVolume) && input.regularMarketVolume >= 0 ? input.regularMarketVolume : null;
  const average = value === null ? null : positive(input?.averageDailyVolume10Day) ? input.averageDailyVolume10Day : positive(input?.averageDailyVolume3Month) ? input.averageDailyVolume3Month : null;
  const date = input?.regularMarketTime;
  const asOf = value !== null && date instanceof Date && finite(date.getTime()) ? date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null;
  const ratio = volume !== null && average !== null ? volume / average : null;
  const fields = { price: value, change, changePercent, open, high, low, volume, averageVolume: average, asOf };
  const missingFields = Object.entries(fields).filter(([, field]) => field === null).map(([field]) => field);
  return {
    ...instrument, ...fields, avgVolume: average, volumeRatio: ratio, dayHigh: high, dayLow: low,
    rangePosition: value !== null && high !== null && low !== null ? rangePosition(value, low, high) : null,
    signal: computeSignal(changePercent, ratio), source: value === null ? "unavailable" : missingFields.length ? "mixed" : "yahoo", missingFields,
  };
}

export function createInitialData(symbol = "^NSEI", now = new Date()): MarketData {
  const instrument = INSTRUMENTS.find((item) => item.symbol === symbol) ?? INSTRUMENTS[0];
  const quotes = INSTRUMENTS.map((item) => normalizeQuote(item));
  const stocks = quotes.filter((q) => q.sector !== null);
  return {
    symbol: instrument.symbol, quote: normalizeQuote(instrument), candles: [], candleSource: "unavailable",
    indices: quotes.filter((q) => q.sector === null), stocks, ...summarize(stocks), moneyRotation: buildMoneyRotation([]),
    marketMood: computeMarketMood(stocks, quotes[0], { value: null, source: "unavailable", asOf: null }),
    coverage: { total: stocks.length, observed: 0, unavailable: stocks.length, mixed: 0 },
    source: "unavailable", fetchedAt: now.toISOString(), warnings: ["Waiting for Yahoo Finance. Missing data is N/A."],
  };
}

export interface MarketMood {
  score: number | null;
  regime: string;
  riskLabel: string;
  source: Source;
  breadth: { advances: number; declines: number; unchanged: number; sample: number; observed: number; total: number };
  indiaVix: { value: number | null; source: Source; asOf: string | null };
  niftyChangePercent: number | null;
  highVolumeBreakouts: number | null;
  components: { breadth: number | null; nifty: number | null; vix: number | null };
}
export function moodRegime(score: number) {
  if (score <= 25) return { regime: "Extreme Fear", riskLabel: "Risk-off" };
  if (score <= 44) return { regime: "Cautious", riskLabel: "Risk-off" };
  if (score <= 55) return { regime: "Neutral", riskLabel: "Neutral" };
  if (score <= 74) return { regime: "Constructive", riskLabel: "Risk-on" };
  return { regime: "Euphoria", riskLabel: "Strong Risk-on" };
}
export function computeMarketMood(stocks: MarketQuote[], nifty: MarketQuote, indiaVix: MarketMood["indiaVix"]): MarketMood {
  const sample = stocks.filter((q) => finite(q.price) && finite(q.changePercent));
  const breadth = summarize(sample).breadth;
  const components = {
    breadth: sample.length ? (breadth.advances + breadth.unchanged * 0.5) / sample.length * 100 : null,
    nifty: finite(nifty.changePercent) ? clamp(50 + nifty.changePercent / 3 * 50) : null,
    vix: positive(indiaVix.value) ? clamp((35 - indiaVix.value) / 25 * 100) : null,
  };
  const score = components.breadth !== null && components.nifty !== null && components.vix !== null
    ? Math.round(clamp(components.breadth * 0.45 + components.nifty * 0.30 + components.vix * 0.25)) : null;
  const sources = [...sample.map((q) => q.source), nifty.source, indiaVix.source];
  const source: Source = score === null ? "unavailable" : sources.every((s) => s === "yahoo") && sample.length === stocks.length ? "yahoo" : "mixed";
  const volumeSample = sample.filter((q) => q.volumeRatio !== null && q.rangePosition !== null);
  return {
    score, ...(score === null ? { regime: "Data unavailable", riskLabel: "N/A" } : moodRegime(score)), source, components,
    breadth: { ...breadth, sample: sample.length, observed: sample.length, total: stocks.length },
    indiaVix, niftyChangePercent: nifty.changePercent,
    highVolumeBreakouts: volumeSample.length ? volumeSample.filter((q) => q.changePercent !== null && q.changePercent > 0 && q.volumeRatio !== null && q.volumeRatio > 2 && q.rangePosition !== null && q.rangePosition >= 0.8).length : null,
  };
}

export const ROTATION_INDICES = [
  { name: "Banking", symbol: "^NSEBANK", volume: 240_000_000 },
  { name: "IT", symbol: "^CNXIT", volume: 180_000_000 },
  { name: "Auto", symbol: "^CNXAUTO", volume: 130_000_000 },
  { name: "Energy", symbol: "^CNXENERGY", volume: 210_000_000 },
  { name: "FMCG", symbol: "^CNXFMCG", volume: 100_000_000 },
  { name: "Pharma", symbol: "^CNXPHARMA", volume: 85_000_000 },
  { name: "Metals", symbol: "^CNXMETAL", volume: 160_000_000 },
  { name: "Infra", symbol: "^CNXINFRA", volume: 150_000_000 },
] as const;
export interface RotationInput { symbol: string; regularMarketChangePercent?: number; regularMarketVolume?: number; regularMarketTime?: Date }
export interface RotationNode {
  name: RotationSector; symbol: string; changePercent: number; volume: number; volumeWeight: number;
  flowCr: number; source: Source; fallbackFields: string[]; asOf: string;
}
export interface MoneyRotationData {
  sectors: RotationNode[]; leaving: RotationNode[]; arriving: RotationNode[]; neutral: RotationNode[];
  unavailable: { name: RotationSector; symbol: string }[];
  links: { from: RotationSector; to: RotationSector; valueCr: number }[];
  matchedCr: number; netCr: number | null; notionalCr: number; source: Source;
}
export function buildMoneyRotation(inputs: RotationInput[]): MoneyRotationData {
  const notionalCr = 100_000;
  const unavailable: MoneyRotationData["unavailable"] = [];
  const values = ROTATION_INDICES.flatMap((index) => {
    const q = inputs.find((item) => item.symbol === index.symbol);
    const change = q?.regularMarketChangePercent;
    if (!finite(change)) { unavailable.push({ name: index.name, symbol: index.symbol }); return []; }
    const volume = q?.regularMarketVolume, date = q?.regularMarketTime;
    const hasVolume = positive(volume);
    const hasDate = date instanceof Date && finite(date.getTime());
    const fallbackFields = [...(!hasVolume ? ["volume weight"] : []), ...(!hasDate ? ["session date"] : [])];
    return [{
      name: index.name, symbol: index.symbol, changePercent: change, volume: hasVolume ? volume : index.volume,
      source: (fallbackFields.length ? "mixed" : "yahoo") as Source, fallbackFields,
      asOf: hasDate ? date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "N/A",
    }];
  });
  const totalVolume = values.reduce((sum, node) => sum + node.volume, 0);
  const sectors: RotationNode[] = values.map((node) => {
    const volumeWeight = node.volume / totalVolume;
    return { ...node, volumeWeight, flowCr: node.changePercent / 100 * volumeWeight * notionalCr };
  });
  const leaving = sectors.filter((node) => node.flowCr < 0).sort((a, b) => a.flowCr - b.flowCr);
  const arriving = sectors.filter((node) => node.flowCr > 0).sort((a, b) => b.flowCr - a.flowCr);
  const outflow = Math.abs(leaving.reduce((sum, node) => sum + node.flowCr, 0));
  const inflow = arriving.reduce((sum, node) => sum + node.flowCr, 0);
  const matchedCr = Math.min(outflow, inflow);
  const links = leaving.flatMap((from) => arriving.map((to) => ({
    from: from.name, to: to.name, valueCr: matchedCr * (-from.flowCr / outflow) * (to.flowCr / inflow),
  })));
  return {
    sectors, leaving, arriving, neutral: sectors.filter((node) => node.flowCr === 0), unavailable,
    links, matchedCr, netCr: sectors.length ? inflow - outflow : null, notionalCr,
    source: !sectors.length ? "unavailable" : !unavailable.length && sectors.every((s) => s.source === "yahoo") ? "yahoo" : "mixed",
  };
}
