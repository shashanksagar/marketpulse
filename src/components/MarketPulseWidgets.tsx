"use client";

import { BarChart3, CircleHelp, TrendingUp } from "lucide-react";
import { percent, type MarketData } from "@/lib/market";

export function MarketPulseWidgets({ data }: { data: MarketData }) {
  const { advances, declines, unchanged } = data.breadth;
  const total = advances + declines + unchanged;
  const denominator = total || 1;
  const sentiment = !total ? "N/A" : advances > declines ? "Bullish" : advances < declines ? "Bearish" : "Neutral";
  const max = Math.max(1, ...data.sectors.map((s) => Math.abs(s.change ?? 0)));
  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="Market pulse analytics">
      <section className="panel p-5">
        <div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-[13px] font-semibold"><BarChart3 size={15} className="text-slate-400" /> Market breadth</h2><span title={`Advances and declines across ${total} observed stocks; unavailable quotes are excluded. Not the entire NSE.`} className="text-slate-500"><CircleHelp size={13} /></span></div>
        <div className="flex items-end justify-between">
          <div><p className="font-mono text-[30px] font-medium leading-none tabular-nums">{advances}<span className="px-2 text-lg text-slate-600">/</span><span className="text-slate-400">{declines}</span></p><p className="mt-2 text-[10px] text-slate-500">Advances vs. declines</p></div>
          <span className={`rounded-md px-2.5 py-1 text-[10px] font-medium ${sentiment === "Bullish" ? "bg-[#24341d] text-[#b7f76b]" : sentiment === "Bearish" ? "bg-[#38232b] text-loss" : "bg-slate-800 text-slate-300"}`}>{sentiment === "Bullish" && <TrendingUp size={11} className="mr-1 inline" />}{sentiment}</span>
        </div>
        <div className="mt-5 flex h-2 gap-1 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`${advances} advancing, ${declines} declining, ${unchanged} unchanged`}>
          <div className="rounded-full bg-[#b7f76b]" style={{ width: `${advances / denominator * 100}%` }} />
          <div className="rounded-full bg-[#ed7587]" style={{ width: `${declines / denominator * 100}%` }} />
          {unchanged > 0 && <div className="bg-slate-500" style={{ width: `${unchanged / denominator * 100}%` }} />}
        </div>
        <div className="mt-3 flex justify-between text-[10px] text-slate-500"><span><span className="text-gain">●</span> <span className="font-mono tabular-nums">{(advances / denominator * 100).toFixed(0)}%</span> advancing</span><span><span className="text-loss">●</span> <span className="font-mono tabular-nums">{(declines / denominator * 100).toFixed(0)}%</span> declining</span></div>
        <p className="mt-4 border-t border-[#252b36] pt-3 text-[10px] text-slate-500">Configured: <span className="font-mono tabular-nums">{data.coverage.total}</span> stocks · <span className="font-mono tabular-nums">{total}</span> with observed change · missing quotes excluded</p>
      </section>
      <section id="sector-flow" className="panel scroll-mt-24 flex-1 p-5">
        <div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-[13px] font-semibold"><TrendingUp size={15} className="text-slate-400" /> Sector performance</h2><span className="rounded border border-[#303743] px-1.5 py-0.5 font-mono text-[9px] text-slate-500">1D</span></div>
        <div className="grid gap-2">
          {[...data.sectors].sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity)).map((sector) => <div key={sector.name} className="grid grid-cols-[80px_1fr_58px] items-center gap-3 text-[10px]">
            <span className="text-slate-400">{sector.name}</span>
            <div className="relative flex h-3 items-center" aria-label={`${sector.name}: ${percent(sector.change)}`}>
              <span className="absolute inset-y-0 left-1/2 w-px bg-[#343c47]" />
              {sector.change !== null && <span className={`absolute h-[6px] rounded-sm ${sector.change >= 0 ? "bg-[#a8d776]" : "bg-[#d67284]"}`} style={{ width: `${Math.abs(sector.change) / max * 48}%`, left: sector.change >= 0 ? "50%" : undefined, right: sector.change < 0 ? "50%" : undefined }} />}
            </div>
            <span className={`text-right font-mono tabular-nums ${sector.change === null ? "text-slate-500" : sector.change >= 0 ? "text-gain" : "text-loss"}`}>{percent(sector.change)}</span>
          </div>)}
        </div>
        <p className="mt-4 border-t border-[#252b36] pt-3 text-[9px] leading-relaxed text-slate-500">Equal-weight observed stock returns; missing quotes excluded. Not actual fund flows.</p>
      </section>
    </aside>
  );
}
