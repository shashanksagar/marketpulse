"use client";

import { useId } from "react";
import { Activity, ArrowUpRight, Info } from "lucide-react";
import { price, percent, type MarketMood } from "@/lib/market";

export default function MarketMoodGauge({ mood }: { mood: MarketMood }) {
  const gradient = useId();
  const color = mood.score === null ? "#94a3b8" : mood.score < 45 ? "#fb7185" : mood.score <= 55 ? "#fbbf24" : "#34d399";
  return (
    <section className="panel flex min-w-0 flex-col" aria-labelledby="market-mood-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#252b36] px-5 py-4">
        <h2 id="market-mood-title" className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} className="text-slate-400" /> Market mood</h2>
        <span className="rounded-full border border-[#303947] bg-[#171e29] px-2.5 py-1 text-[9px] text-slate-400">NSE F&O · Delayed</span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-5 pb-6 pt-5">
        <div className="mb-3 flex w-full items-center justify-between text-[10px] text-slate-500"><span>THE RISK APPETITE RADAR</span><span className={`rounded border px-2 py-1 uppercase ${mood.source === "yahoo" ? "border-emerald-500/20 text-emerald-400" : "border-amber-500/20 text-amber-300/80"}`}>{mood.source === "yahoo" ? "Yahoo inputs" : mood.source === "unavailable" ? "Data unavailable" : "Partial inputs"}</span></div>
        <svg viewBox="0 0 320 218" className="my-auto w-full max-w-[410px]" role={mood.score === null ? "img" : "meter"} aria-label={mood.score === null ? "Market mood score unavailable" : "Market mood score"} aria-valuemin={mood.score === null ? undefined : 0} aria-valuemax={mood.score === null ? undefined : 100} aria-valuenow={mood.score ?? undefined} aria-valuetext={mood.score === null ? undefined : `${mood.score}: ${mood.regime}, ${mood.riskLabel}`}>
          <defs><linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f43f5e" /><stop offset="50%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#10b981" /></linearGradient></defs>
          <path d="M 28 162 A 132 132 0 0 1 292 162" fill="none" stroke="#232c38" strokeWidth="22" strokeLinecap="round" />
          <path d="M 28 162 A 132 132 0 0 1 292 162" fill="none" stroke={`url(#${gradient})`} strokeWidth="17" strokeLinecap="round" />
          {[0, 25, 50, 75, 100].map((value) => {
            const angle = Math.PI - value / 100 * Math.PI;
            return <line key={value} x1={160 + Math.cos(angle) * 109} y1={162 - Math.sin(angle) * 109} x2={160 + Math.cos(angle) * 102} y2={162 - Math.sin(angle) * 102} stroke="#485264" strokeWidth="1.5" />;
          })}
          {mood.score !== null && <g transform="translate(160 162)">
            <g style={{ transform: `rotate(${-90 + mood.score * 1.8}deg)`, transition: "transform 900ms cubic-bezier(0.2,0.8,0.2,1)" }} data-testid="mood-needle">
              <path d="M 0 -151 L -5 -123 L 5 -123 Z" fill="#e2e8f0" />
              <circle cx="0" cy="-132" r="5" fill="#10141c" stroke="#f8fafc" strokeWidth="2" />
            </g>
          </g>}
          <text x="160" y="106" textAnchor="middle" fill="#758195" fontSize="9" letterSpacing="2">MARKET MOOD</text>
          <text x="160" y="153" textAnchor="middle" fill="#f1f5f9" fontSize="48" fontWeight="700" className="font-mono tabular-nums">{mood.score ?? "N/A"}</text>
          <text x="160" y="175" textAnchor="middle" fill={color} fontSize="12" fontWeight="600">{mood.regime}</text>
          <text x="17" y="201" fill="#9c7780" fontSize="10" className="font-mono tabular-nums">0 Risk-off</text>
          <text x="303" y="201" textAnchor="end" fill="#72a892" fontSize="10" className="font-mono tabular-nums">100 Risk-on</text>
        </svg>
        <div className="mb-6 rounded-full border px-4 py-1.5 text-xs font-medium" style={{ color, borderColor: `${color}40`, backgroundColor: `${color}10` }}>{mood.riskLabel}</div>
        <div className="grid w-full grid-cols-3 divide-x divide-[#29313d] rounded-xl border border-[#29313d] bg-[#0d121a] py-4 text-center">
          <div className="px-1"><p className="text-[9px] text-slate-500">F&O Advances/Declines</p><p className="mt-2 font-mono text-lg font-semibold tabular-nums"><span className="text-emerald-400">{mood.breadth.advances}</span><span className="px-1 text-slate-600">/</span><span className="text-rose-400">{mood.breadth.declines}</span></p><p className="mt-1 font-mono text-[8px] tabular-nums text-slate-500">{mood.breadth.unchanged} unchanged</p></div>
          <div className="px-1"><p className="text-[9px] text-slate-500">India VIX</p><p className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-200">{price(mood.indiaVix.value)}</p><p className={`mt-1 text-[8px] uppercase ${mood.indiaVix.source === "yahoo" ? "text-slate-500" : "text-amber-300/80"}`}>{mood.indiaVix.source === "unavailable" ? "Unavailable" : mood.indiaVix.asOf ?? "Date unavailable"}</p></div>
          <div className="px-1"><p className="text-[9px] text-slate-500">High-volume breakouts</p><p className="mt-2 flex items-center justify-center gap-1 font-mono text-lg font-semibold tabular-nums text-emerald-400">{mood.highVolumeBreakouts ?? "N/A"}{mood.highVolumeBreakouts !== null && <ArrowUpRight size={14} />}</p><p className="mt-1 text-[8px] text-slate-500">&gt;2x · upper 20% of range</p></div>
        </div>
        <div className="mt-4 flex w-full flex-wrap justify-between gap-2 font-mono text-[9px] tabular-nums text-slate-500"><span>{mood.breadth.observed}/{mood.breadth.total} observed stocks</span><span>NIFTY {percent(mood.niftyChangePercent)}</span></div>
      </div>
      <div className="flex items-start gap-2 rounded-b-xl border-t border-[#252b36] bg-[#0d1118] px-5 py-3 text-[9px] leading-relaxed text-slate-500"><Info size={12} className="mt-px shrink-0" /><p>Model score, not a forecast. Breadth <span className="font-mono tabular-nums">45%</span> + NIFTY <span className="font-mono tabular-nums">30%</span> + inverse VIX <span className="font-mono tabular-nums">25%</span>. Missing observations are excluded. The score is N/A if a required component is unavailable.</p></div>
    </section>
  );
}
