"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, ArrowRight, CalendarDays, ChartNoAxesCombined, Clock3, Info, Radio, RefreshCw, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import Navbar, { type Tab } from "./Navbar";
import CommandPalette from "./CommandPalette";
import TradingChart from "./TradingChart";
import MoneyRotation from "./MoneyRotation";
import MarketMoodGauge from "./MarketMoodGauge";
import FnoScannerTable from "./FnoScannerTable";
import { MarketPulseWidgets } from "./MarketPulseWidgets";
import { INSTRUMENTS, decimal, finite, normalizeQuote, percent, price, type MarketData, type Sector } from "@/lib/market";
import { useWatchlist } from "@/lib/watchlist";

export default function Dashboard({ initialData }: { initialData: MarketData }) {
  const [data, setData] = useState(initialData);
  const [symbol, setSymbol] = useState("^NSEI");
  const [active, setActive] = useState<Tab>("Pulse");
  const [palette, setPalette] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const { watchlist, toggle: toggleWatch, storageError } = useWatchlist();
  const [watchOnly, setWatchOnly] = useState(false);
  const [rotationSector, setRotationSector] = useState<Sector | null>(null);
  const refreshRequested = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => { triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPalette(true); }, []);
  const closePalette = useCallback(() => { setPalette(false); triggerRef.current?.focus(); }, []);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const bypass = refreshRequested.current;
    refreshRequested.current = false;
    async function load(refresh = false) {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}${refresh ? "&refresh=true" : ""}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Market data request failed (${response.status})`);
        const result: MarketData = await response.json();
        if (result.symbol !== symbol || !Array.isArray(result.candles) || !result.quote || !result.moneyRotation || !result.marketMood || !result.coverage) throw new Error("Incomplete market response");
        setData(result);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error("Market data request failed", e);
        setError("Yahoo data could not be loaded. Previously fetched observations remain visible; missing values are N/A. Retry to reconnect.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load(bypass);
    const interval = setInterval(() => { void load(); }, 30 * 60 * 1000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [symbol, reload]);

  function selectSymbol(next: string) {
    if (next !== symbol) {
      const instrument = INSTRUMENTS.find((item) => item.symbol === next);
      if (!instrument) { setError("This symbol is not in the configured NSE universe."); return; }
      setData((previous) => ({
        ...previous, symbol: next,
        quote: [...previous.stocks, ...previous.indices].find((q) => q.symbol === next) ?? normalizeQuote(instrument),
        candles: [], candleSource: "unavailable",
      }));
      setLoading(true);
      setSymbol(next);
    }
    document.getElementById("market-chart")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function navigate(tab: Tab) {
    setActive(tab);
    setWatchOnly(tab === "Watchlist");
    if (tab === "Pulse") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(tab === "Sector Flow" ? "sector-flow" : "scanner")?.scrollIntoView({ behavior: "smooth" });
  }
  function selectRotationSector(sector: Sector | null) {
    setRotationSector(sector);
    setWatchOnly(false);
    setActive("Screeners");
    if (sector) document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const breadthCount = data.breadth.advances + data.breadth.declines + data.breadth.unchanged;
  const sentiment = !breadthCount ? "N/A" : data.breadth.advances > data.breadth.declines ? "Bullish" : data.breadth.advances < data.breadth.declines ? "Bearish" : "Neutral";
  const ratios = data.stocks.flatMap((q) => finite(q.volumeRatio) ? [q.volumeRatio] : []);
  const avgVolume = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null;
  const leadingSector = data.sectors.filter((sector) => sector.change !== null).sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];
  const date = new Date(data.fetchedAt);
  const sourceNotice = loading
    ? "Connecting to Yahoo Finance. Missing values display N/A; previously fetched observations remain visible."
    : data.source === "unavailable" ? "DATA UNAVAILABLE — Yahoo Finance could not supply market observations. Missing values are N/A, never simulated prices."
    : data.source === "mixed" ? "PARTIAL DATA — Some Yahoo fields are unavailable and display N/A. Analytics exclude missing observations; rotation volume weights are explicitly modeled."
    : "Yahoo Finance delayed / end-of-day data. No live feed. Cached for 30 minutes.";
  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100">
      <Navbar active={active} onNavigate={navigate} onSearch={openPalette} />
      <div className="border-b border-[#232832] bg-[#0d1118]">
        <div className="mx-auto grid max-w-[1600px] grid-cols-1 sm:grid-cols-3">
          {data.indices.map((q) => <button key={q.symbol} onClick={() => selectSymbol(q.symbol)} className={`group flex items-center justify-between gap-4 border-b border-[#232832] px-5 py-4 text-left last:border-b-0 sm:border-b-0 sm:border-r sm:px-8 sm:last:border-r-0 ${symbol === q.symbol ? "bg-[#b7f76b]/[0.025]" : "hover:bg-[#151b23]"}`}>
            <div><span className="text-[10px] font-semibold tracking-wider text-slate-400">{q.name}</span><span className="ml-2 text-[8px] uppercase text-slate-600">{q.source === "yahoo" ? "NSE" : q.source}</span><div className="mt-1.5 font-mono text-lg font-medium tabular-nums tracking-tight">{price(q.price)}</div></div>
            <div className="text-right"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] tabular-nums ${q.changePercent === null ? "text-slate-500" : q.changePercent >= 0 ? "bg-[#1c2a20] text-gain" : "bg-[#2a1e27] text-loss"}`}>{q.changePercent !== null && (q.changePercent >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />)}{percent(q.changePercent)}</span><div className="mt-1.5 font-mono text-[10px] tabular-nums text-slate-500">{q.change === null ? "N/A" : `${q.change >= 0 ? "+" : "-"}${price(Math.abs(q.change))} pts`}</div></div>
          </button>)}
        </div>
      </div>
      <main className="mx-auto max-w-[1600px] px-4 pb-8 pt-7 sm:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div><div className="mb-2 flex items-center gap-2 text-[9px] font-semibold tracking-[0.18em] text-[#9caf8a]"><Radio size={11} /> THE MARKET, AT A GLANCE</div><h1 className="text-[27px] font-semibold tracking-tight">Market pulse<span className="text-[#b7f76b]">.</span></h1><p className="mt-1.5 text-xs text-slate-500">Cut through the noise. See where the market is moving.</p></div>
          <div className="flex items-center gap-3"><div className="hidden text-right text-[10px] leading-5 text-slate-500 sm:block"><span className="flex items-center justify-end gap-1.5"><CalendarDays size={11} />{date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</span><span className="font-mono tabular-nums">Fetched {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST</span></div><button onClick={() => { refreshRequested.current = true; setReload((n) => n + 1); }} disabled={loading} title="Bypass the 30-minute server cache and refetch Yahoo data" className="flex items-center gap-2 rounded-lg border border-[#303843] bg-[#151b24] px-3 py-2.5 text-[11px] text-slate-300 disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh</button></div>
        </div>
        <div role="status" className={`mb-5 flex items-start gap-2 rounded-lg border px-3 py-2 text-[10px] leading-relaxed ${data.source === "yahoo" && !error ? "border-[#29372b] bg-[#141c15] text-[#9db692]" : "border-[#3c3526] bg-[#1c1913] text-[#bdac85]"}`}><Info size={13} className="mt-px shrink-0" /><span>{error || sourceNotice}{storageError && ` ${storageError}`}</span><span className="ml-auto hidden shrink-0 items-center gap-1.5 sm:flex"><Clock3 size={11} /> 30m cache</span></div>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "MARKET SENTIMENT", value: sentiment, detail: `${data.breadth.advances} of ${breadthCount} observed stocks advancing`, icon: Activity, color: sentiment === "Bearish" ? "text-loss" : "text-gain" },
            { label: "VOLUME ACTIVITY", value: decimal(avgVolume, 2, "x"), detail: "vs. Yahoo 10D / 3M average", icon: ChartNoAxesCombined, color: "text-slate-100" },
            { label: "BULLISH SIGNALS", value: data.stocks.some((q) => q.signal !== null) ? String(data.stocks.filter((q) => q.signal === "Long Buildup" || q.signal === "Short Covering").length).padStart(2, "0") : "N/A", detail: "Long buildup + short covering", icon: Zap, color: "text-gain" },
            { label: "LEADING SECTOR", value: leadingSector?.name ?? "N/A", detail: `${percent(leadingSector?.change ?? null)} average price change`, icon: TrendingUp, color: "text-slate-100" },
          ].map((item) => <div key={item.label} className="panel relative px-4 py-4"><span className="absolute right-4 top-4 rounded-md bg-[#1d2524] p-1.5 text-[#8fa878]"><item.icon size={14} /></span><p className="pr-7 text-[9px] font-medium tracking-[0.09em] text-slate-500">{item.label}</p><p className={`mt-3 font-mono text-[22px] font-medium tabular-nums tracking-tight ${item.color}`}>{item.value}</p><p className="mt-1.5 font-mono text-[9px] tabular-nums text-slate-500">{item.detail}</p></div>)}
        </div>
        <div id="market-chart" className="mb-5 grid scroll-mt-24 grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8"><TradingChart data={data} onSearch={openPalette} loading={loading} /></div>
          <div className="min-w-0 lg:col-span-4"><MarketPulseWidgets data={data} /></div>
        </div>
        <div className="mb-5 grid min-w-0 grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          <MarketMoodGauge mood={data.marketMood} />
          <MoneyRotation data={data.moneyRotation} selectedSector={rotationSector} onSectorSelect={selectRotationSector} />
        </div>
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-[#283326] bg-gradient-to-r from-[#182016] to-[#10151b] px-4 py-3"><span className="rounded bg-[#2b3c23] p-1.5 text-[#b7f76b]"><Zap size={13} /></span><span className="text-[11px] text-slate-400"><strong className="font-medium text-[#c2d7b1]">A little context goes a long way.</strong> Price + volume reveal conviction. Explore the signals behind the moves.</span><button onClick={() => navigate("Screeners")} className="ml-auto flex items-center gap-1 text-[10px] text-[#b7f76b]">Explore scanner <ArrowRight size={12} /></button></div>
        <FnoScannerTable stocks={data.stocks} onSelect={selectSymbol} watchlist={watchlist} onToggleWatch={toggleWatch} watchOnly={watchOnly} onWatchOnly={setWatchOnly} sectorFilter={rotationSector} onSectorChange={setRotationSector} />
        <div className="mt-5 flex items-start gap-2 px-1 text-[10px] leading-relaxed text-slate-600"><ShieldCheck size={14} className="mt-px shrink-0" /><p>Built for perspective, not predictions. Directional signals simulate open-interest behavior using price change and volume, not actual derivatives OI. Sector flow is an equal-weight return proxy. Breadth covers only the tracked stocks.</p></div>
      </main>
      <footer className="border-t border-[#222832] px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-[1536px] flex-wrap items-center justify-between gap-3 text-[10px] text-slate-600"><span className="flex items-center gap-2"><Activity size={13} className="text-[#90ad71]" /><span className="font-semibold text-slate-400">marketpulse.</span><span className="ml-2">Independent market intelligence</span></span><p>Public Yahoo Finance data · Delayed / end-of-day · Not investment advice</p><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#7c9f5b]" /> No keys. No subscriptions.</span></div></footer>
      <CommandPalette key={palette ? "open" : "closed"} open={palette} onClose={closePalette} onSelect={selectSymbol} />
    </div>
  );
}
