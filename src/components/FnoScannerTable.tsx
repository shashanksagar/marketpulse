"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, ArrowUpRight, ChevronLeft, ChevronRight, ListFilter, Search, Star, X } from "lucide-react";
import { STOCK_SECTORS } from "@/data/fnoStocks";
import { decimal, percent, price, ticker, type MarketQuote, type Sector, type Signal } from "@/lib/market";

const QUICK_FILTERS = ["All F&O", "Top Gainers", "Top Losers", "Volume Shockers", "Long Buildup", "Short Covering", "Short Buildup"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];
type SortKey = "symbol" | "price" | "changePercent" | "volumeRatio" | "rangePosition" | "signal";
const PAGE_SIZE = 25;
const signalColors: Record<Signal, string> = {
  "Long Buildup": "bg-[#233521] text-[#afe28c]",
  "Short Covering": "bg-[#18302d] text-[#76cdb5]",
  "Short Buildup": "bg-[#38232c] text-[#ed8c9d]",
  "Long Unwinding": "bg-[#332c20] text-[#d9b977]",
  "Neutral": "bg-[#252c37] text-slate-400",
};

export default function FnoScannerTable({ stocks, onSelect, sectorFilter, onSectorChange, watchlist, onToggleWatch, watchOnly, onWatchOnly }: {
  stocks: MarketQuote[]; onSelect: (symbol: string) => void;
  sectorFilter: Sector | null; onSectorChange: (sector: Sector | null) => void;
  watchlist: string[]; onToggleWatch: (symbol: string) => void;
  watchOnly: boolean; onWatchOnly: (value: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("All F&O");
  const [signal, setSignal] = useState<Signal | "All signals">("All signals");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "volumeRatio", descending: true });
  const [pagination, setPagination] = useState({ page: 1, criteria: "" });
  const criteria = JSON.stringify([query, quick, signal, sectorFilter, watchOnly, watchlist, sort]);
  const rows = useMemo(() => stocks.filter((q) => {
    if (sectorFilter && q.sector !== sectorFilter) return false;
    if (watchOnly && !watchlist.includes(q.symbol)) return false;
    if (signal !== "All signals" && q.signal !== signal) return false;
    if (!`${q.symbol} ${q.name}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (quick === "Top Gainers") return q.changePercent !== null && q.changePercent > 0;
    if (quick === "Top Losers") return q.changePercent !== null && q.changePercent < 0;
    if (quick === "Volume Shockers") return q.volumeRatio !== null && q.volumeRatio > 2;
    if (quick !== "All F&O") return q.signal === quick;
    return true;
  }).sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av === null && bv === null) return a.symbol.localeCompare(b.symbol);
    if (av === null) return 1;
    if (bv === null) return -1;
    const difference = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return difference * (sort.descending ? -1 : 1) || a.symbol.localeCompare(b.symbol);
  }), [stocks, sectorFilter, watchOnly, watchlist, signal, query, quick, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = pagination.criteria === criteria ? Math.min(pagination.page, pages) : 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const unavailableCount = stocks.filter((q) => q.source === "unavailable").length;
  const partialCount = stocks.filter((q) => q.source === "mixed").length;
  function chooseQuick(value: QuickFilter) {
    setQuick(value);
    if (value === "Top Gainers" || value === "Top Losers") setSort({ key: "changePercent", descending: value === "Top Gainers" });
    else if (value === "Volume Shockers") setSort({ key: "volumeRatio", descending: true });
  }
  function changeSort(key: SortKey) { setSort({ key, descending: sort.key === key ? !sort.descending : true }); }
  const columns: [SortKey, string][] = [["symbol", "Symbol / Sector"], ["price", "LTP (₹)"], ["changePercent", "% Change"], ["volumeRatio", "Volume vs Avg"], ["rangePosition", "Day Range"], ["signal", "OI / Flow Signal"]];
  return (
    <section id="scanner" className="panel scroll-mt-24 overflow-hidden" aria-labelledby="scanner-title">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
        <div className="flex items-center gap-3"><span className="rounded-lg bg-[#202b1e] p-2 text-[#b7f76b]"><ListFilter size={18} /></span><div><h2 id="scanner-title" className="text-sm font-semibold">NSE F&O Market Scanner</h2><p className="mt-1 text-[10px] text-slate-500"><span className="font-mono tabular-nums">{stocks.length}</span> configured stocks · delayed quotes · simulated OI signals</p></div></div>
        <button onClick={() => onWatchOnly(!watchOnly)} aria-pressed={watchOnly} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] ${watchOnly ? "border-[#5a7341] text-[#b7f76b]" : "border-[#2b323e] text-slate-400"}`}><Star size={12} /> Watchlist <span className="font-mono tabular-nums">{watchlist.length}</span></button>
      </div>
      <div className="flex flex-wrap gap-2 border-y border-[#252b36] bg-[#0d1118] px-5 py-3">
        {QUICK_FILTERS.map((value) => <button key={value} onClick={() => chooseQuick(value)} aria-pressed={quick === value} className={`rounded-full border px-3 py-1.5 text-[10px] ${quick === value ? "border-[#658b43] bg-[#24341d] text-[#b7f76b]" : "border-[#2a3340] text-slate-400 hover:border-slate-500"}`}>{value}{value === "All F&O" && <span className="ml-1 font-mono tabular-nums">({stocks.length})</span>}{value === "Volume Shockers" && <span className="font-mono tabular-nums"> (&gt;2x Avg)</span>}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <label className="relative min-w-[180px] flex-1"><Search size={14} className="absolute left-3 top-3 text-slate-500" /><span className="sr-only">Search F&O stocks</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search symbol or company..." className="w-full rounded-lg border border-[#2b323e] bg-[#0c1119] py-2.5 pl-9 pr-3 text-xs outline-none focus:border-[#b7f76b]" /></label>
        <label><span className="sr-only">Filter scanner sector</span><select aria-label="Filter scanner sector" value={sectorFilter ?? ""} onChange={(e) => onSectorChange(STOCK_SECTORS.find((sector) => sector === e.target.value) ?? null)} className="max-w-full rounded-lg border border-[#2b323e] bg-[#161c26] p-2.5 text-[11px] text-slate-300"><option value="">All sectors</option>{STOCK_SECTORS.map((sector) => <option key={sector}>{sector}</option>)}</select></label>
        <label><span className="sr-only">Filter directional signal</span><select aria-label="Filter directional signal" value={signal} onChange={(e) => { const selected = (Object.keys(signalColors) as Signal[]).find((s) => s === e.target.value); setSignal(selected ?? "All signals"); }} className="rounded-lg border border-[#2b323e] bg-[#161c26] p-2.5 text-[11px] text-slate-300"><option>All signals</option>{Object.keys(signalColors).map((value) => <option key={value}>{value}</option>)}</select></label>
        {sectorFilter && <button onClick={() => onSectorChange(null)} aria-label="Clear scanner sector filter" className="flex items-center gap-1 rounded-lg bg-[#24341d] px-2 py-2 text-[10px] text-[#b7f76b]">{sectorFilter}<X size={12} /></button>}
        <button onClick={() => { setQuery(""); setQuick("All F&O"); setSignal("All signals"); onSectorChange(null); onWatchOnly(false); setSort({ key: "volumeRatio", descending: true }); }} className="text-[10px] text-slate-500 hover:text-white">Reset filters</button>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-left text-xs">
          <thead className="border-y border-[#252b36] bg-[#0d1118] text-[10px] text-slate-500"><tr><th className="w-10 pl-5"><span className="sr-only">Watchlist</span><Star size={11} /></th>{columns.map(([key, label]) => <th key={key} className={`px-4 py-3 font-medium ${key === "symbol" ? "" : "text-right"}`} aria-sort={sort.key === key ? sort.descending ? "descending" : "ascending" : "none"}><button onClick={() => changeSort(key)} className="inline-flex items-center gap-2 hover:text-white">{label}<ArrowDownUp size={10} className={sort.key === key ? "text-[#b7f76b]" : ""} /></button></th>)}<th className="pr-3"><span className="sr-only">Open chart</span></th></tr></thead>
          <tbody>{pageRows.map((q) => <tr key={q.symbol} onClick={() => onSelect(q.symbol)} className="cursor-pointer border-b border-[#202630] transition-colors last:border-b-0 hover:bg-[#19212b]">
            <td className="pl-5"><button onClick={(event) => { event.stopPropagation(); onToggleWatch(q.symbol); }} aria-label={`${watchlist.includes(q.symbol) ? "Remove" : "Add"} ${ticker(q.symbol)} ${watchlist.includes(q.symbol) ? "from" : "to"} watchlist`} aria-pressed={watchlist.includes(q.symbol)} className={`p-1 ${watchlist.includes(q.symbol) ? "text-[#b7f76b]" : "text-slate-600 hover:text-[#b7f76b]"}`}><Star size={13} fill={watchlist.includes(q.symbol) ? "currentColor" : "none"} /></button></td>
            <td className="max-w-[260px] px-4 py-3"><button onClick={(event) => { event.stopPropagation(); onSelect(q.symbol); }} aria-label={`Open ${ticker(q.symbol)} chart`} className="block text-left"><span className="font-semibold text-slate-200">{ticker(q.symbol)}</span><span className="ml-2 rounded bg-[#252d38] px-1.5 py-0.5 text-[8px] text-slate-400">{q.sector}</span><span className="mt-1 block max-w-[240px] truncate text-[10px] text-slate-500">{q.name}</span></button><span title={`${q.asOf ?? "N/A"}${q.missingFields.length ? ` · Missing: ${q.missingFields.join(", ")}` : ""}`} className={`mt-1 block text-[8px] uppercase ${q.source === "yahoo" ? "text-slate-600" : "text-amber-400/70"}`}>{q.source === "yahoo" ? "NSE delayed" : q.source === "unavailable" ? "Quote unavailable" : "Partial quote"}</span></td>
            <td className="px-4 text-right font-mono tabular-nums text-slate-200">{q.price === null ? "N/A" : `₹${price(q.price)}`}</td>
            <td className={`px-4 text-right font-mono tabular-nums ${q.changePercent === null ? "text-slate-500" : q.changePercent >= 0 ? "text-gain" : "text-loss"}`}>{percent(q.changePercent)}</td>
            <td className="px-4 text-right"><span className="font-mono tabular-nums text-slate-200">{decimal(q.volumeRatio, 2, "x")}</span><span className="ml-2 inline-flex items-end gap-0.5" aria-hidden="true">{[0.5, 1, 1.5, 2, 3].map((level, index) => <span key={level} className={`w-1 rounded-[1px] ${q.volumeRatio !== null && q.volumeRatio >= level ? "bg-[#a4d873]" : "bg-[#2c3440]"}`} style={{ height: 4 + index * 2 }} />)}</span><span className="mt-1 block whitespace-nowrap font-mono text-[9px] tabular-nums text-slate-500">{decimal(q.volume === null ? null : q.volume / 1e6, 2, "M")} / {decimal(q.avgVolume === null ? null : q.avgVolume / 1e6, 2, "M")}</span></td>
            <td className="w-36 px-4">{q.rangePosition === null ? <span className="block text-center font-mono tabular-nums text-slate-500">N/A</span> : <div className="relative my-2 h-1 rounded-full bg-[#2c3440]" role="img" aria-label={`${ticker(q.symbol)} day range position ${(q.rangePosition * 100).toFixed(0)} percent`}><span className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#10141c] ${q.changePercent !== null && q.changePercent >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ left: `${q.rangePosition * 100}%` }} /></div>}<div className="mt-2 flex justify-between gap-2 font-mono text-[8px] tabular-nums text-slate-500"><span>{price(q.dayLow)}</span><span>{price(q.dayHigh)}</span></div></td>
            <td className="px-4 text-right"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-[10px] ${q.signal === null ? "text-slate-500" : signalColors[q.signal]}`}><span className="size-1 rounded-full bg-current" />{q.signal ?? "N/A"}</span></td>
            <td className="pr-4 text-slate-500"><ArrowUpRight size={13} /></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <div role="status" className="p-12 text-center text-sm text-slate-400">No stocks match these filters. Clear filters or choose another sector.</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#252b36] px-5 py-4">
        <p role="status" aria-live="polite" className="font-mono text-[10px] tabular-nums text-slate-500">{rows.length ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length} matches</p>
        <div className="flex items-center gap-3"><button disabled={currentPage === 1} onClick={() => setPagination({ page: currentPage - 1, criteria })} className="flex items-center gap-1 rounded-lg border border-[#2b323e] px-3 py-2 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={13} /> Prev</button><span className="font-mono text-[10px] tabular-nums text-slate-500">{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPagination({ page: currentPage + 1, criteria })} className="flex items-center gap-1 rounded-lg border border-[#2b323e] px-3 py-2 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">Next <ChevronRight size={13} /></button></div>
      </div>
      <div className="border-t border-[#252b36] bg-[#0d1118] px-5 py-3 text-[9px] leading-relaxed text-slate-500">Volume baseline: Yahoo 10-day average, otherwise 3-month average; missing fields display N/A. <span className="font-mono tabular-nums">{unavailableCount}</span> unavailable / <span className="font-mono tabular-nums">{partialCount}</span> partial rows. OI badges are price-volume proxies, not actual open interest. Current exchange F&O eligibility may differ from this configured universe.</div>
    </section>
  );
}
