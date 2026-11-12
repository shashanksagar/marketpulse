"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart } from "lightweight-charts";
import { ArrowDownRight, ArrowUpRight, ChartCandlestick, ChevronDown, Maximize2 } from "lucide-react";
import { percent, price, type Candle, type MarketData } from "@/lib/market";

export default function TradingChart({ data, onSearch, loading }: { data: MarketData; onSearch: () => void; loading: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [months, setMonths] = useState(6);
  const [hovered, setHovered] = useState<{ candle: Candle; symbol: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const q = data.quote;
  const positive = q.changePercent !== null && q.changePercent >= 0;
  useEffect(() => {
    if (!containerRef.current || !data.candles.length) return;
    const end = new Date(`${data.candles[data.candles.length - 1].time}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - months);
    const candles = data.candles.filter((c) => c.time >= start.toISOString().slice(0, 10));
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#10141c" }, textColor: "#738095", fontFamily: "Consolas, monospace", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1a202b" }, horzLines: { color: "#1e2430" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#738095", labelBackgroundColor: "#333e4b" }, horzLine: { color: "#738095", labelBackgroundColor: "#333e4b" } },
      rightPriceScale: { borderColor: "#252c38", scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor: "#252c38", timeVisible: false, rightOffset: 4, barSpacing: 7 },
      localization: { locale: "en-IN", priceFormatter: price },
      handleScroll: true, handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#a7e77a", downColor: "#ed7587", wickUpColor: "#a7e77a", wickDownColor: "#ed7587", borderVisible: false,
      priceLineColor: "#b7f76b", priceLineStyle: 2,
    });
    series.setData(candles);
    const volumes = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    volumes.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    volumes.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "#a7e77a35" : "#ed758735" })));
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((event) => {
      const candle = candles.find((c) => c.time === event.time);
      setHovered(candle ? { candle, symbol: data.symbol } : null);
    });
    return () => chart.remove();
  }, [data.candles, data.symbol, months]);
  const activeCandle = hovered?.symbol === data.symbol && data.candles.includes(hovered.candle) ? hovered.candle : null;
  const displayed = activeCandle ?? q;
  const close = "close" in displayed ? displayed.close : displayed.price;
  return (
    <section ref={panelRef} className={`panel flex min-w-0 flex-col ${expanded ? "fixed inset-4 z-40 shadow-[0_0_0_100vmax_#000b]" : ""}`} aria-label="Interactive price chart">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#252b36] p-5">
        <div>
          <button onClick={onSearch} className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-md bg-[#263121] text-[#b7f76b]"><ChartCandlestick size={16} /></span>{q.name}<ChevronDown size={14} className="text-slate-500" /><span className="text-[10px] font-normal text-slate-500">NSE</span></button>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-[28px] font-semibold leading-none tabular-nums tracking-tight">{price(q.price)}</span>
            <span className={`flex items-center gap-1 font-mono text-xs tabular-nums ${q.changePercent === null ? "text-slate-500" : positive ? "text-gain" : "text-loss"}`}>{q.changePercent !== null && (positive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />)}{price(q.change === null ? null : Math.abs(q.change))} ({percent(q.changePercent)})</span>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">{q.asOf ?? "N/A"} · {q.source === "yahoo" ? "Delayed / end-of-day quote" : q.source === "mixed" ? "Partial quote · missing fields N/A" : "Quote unavailable"}{loading && " · Updating..."}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-[#0b0f16] p-1" aria-label="Chart timeframe">
            {[1, 3, 6].map((value) => <button key={value} onClick={() => { setMonths(value); setHovered(null); }} aria-pressed={months === value} className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] tabular-nums ${months === value ? "bg-[#2d3b25] text-[#b7f76b]" : "text-slate-500 hover:text-white"}`}>{value}M</button>)}
          </div>
          <button onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Collapse chart" : "Expand chart"} aria-pressed={expanded} className="rounded p-1.5 text-slate-500 hover:text-white"><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-4 font-mono text-[10px] tabular-nums text-slate-500">
        {([["O", displayed.open], ["H", displayed.high], ["L", displayed.low], ["C", close]] as const).map(([label, value]) => <span key={label}>{label} <span className="ml-1 text-slate-300">{price(value)}</span></span>)}
        <span className={q.changePercent === null ? "text-slate-500" : positive ? "text-gain" : "text-loss"}>{percent(q.changePercent)}</span>
        <span className="ml-auto">{activeCandle?.time ?? "1D CANDLES"}</span>
      </div>
      <div className={`relative ${expanded ? "min-h-0 flex-1" : "h-[340px] sm:h-[380px]"} mx-2 mt-3`}>
        <div ref={containerRef} className="h-full w-full" data-testid="trading-chart" />
        {!data.candles.length && <div role="status" className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">{loading ? "Loading price history..." : "N/A — price history is unavailable for this symbol."}</div>}
      </div>
      <div className="flex items-center justify-between border-t border-[#252b36] px-5 py-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#b7f76b]" /> Price <span className="ml-3 size-1.5 rounded-sm bg-[#6a8460]" /> Volume</span>
        <span>{data.candleSource === "unavailable" ? "NO PRICE HISTORY" : "YAHOO FINANCE"} <span className="mx-1.5 text-slate-700">/</span> Scroll to zoom · Drag to pan</span>
      </div>
    </section>
  );
}
