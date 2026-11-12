"use client";

import { Activity, ArrowUpRight, Command, Search } from "lucide-react";

export type Tab = "Pulse" | "Sector Flow" | "Screeners" | "Watchlist";

export default function Navbar({ active, onNavigate, onSearch }: {
  active: Tab; onNavigate: (tab: Tab) => void; onSearch: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#232832] bg-[#0B0E14]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1600px] items-center gap-8 px-4 sm:px-8">
        <button onClick={() => onNavigate("Pulse")} className="flex shrink-0 items-center gap-2.5" aria-label="Market Pulse home">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#b7f76b] text-[#12200b]"><Activity size={23} strokeWidth={2.6} /></span>
          <span className="text-[19px] font-bold tracking-tight">market<span className="text-[#b7f76b]">pulse</span><span className="ml-1 text-[#657083]">.</span></span>
        </button>
        <nav className="hidden h-full items-center gap-6 md:flex" aria-label="Main navigation">
          {(["Pulse", "Sector Flow", "Screeners", "Watchlist"] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => onNavigate(tab)} aria-current={active === tab ? "page" : undefined}
              className={`relative h-full text-[13px] font-medium transition-colors ${active === tab ? "text-[#b7f76b] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#b7f76b]" : "text-slate-400 hover:text-white"}`}>{tab}</button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden items-center gap-2 rounded-full border border-[#28352d] bg-[#142019] px-3 py-1.5 text-[10px] font-semibold tracking-wide text-[#9ac3a8] lg:flex"><span className="size-1.5 rounded-full bg-[#9bd875]" /> NSE EOD / DELAYED</span>
          <button onClick={onSearch} className="flex items-center gap-3 rounded-lg border border-[#2a303b] bg-[#141821] px-3 py-2 text-xs text-slate-400 hover:border-slate-500" aria-label="Search symbols">
            <Search size={15} /><span className="hidden sm:inline">Search symbols</span><kbd className="hidden items-center gap-1 rounded border border-[#323946] px-1 text-[10px] sm:flex"><Command size={10} /> Ctrl K</kbd>
          </button>
          <span className="hidden size-8 items-center justify-center rounded-full border border-[#37412d] bg-[#252d1c] text-xs font-semibold text-[#c3dc9e] sm:flex" title="Local workspace, no account required">MP</span>
        </div>
      </div>
      <nav className="flex justify-around border-t border-[#202630] md:hidden" aria-label="Mobile navigation">
        {(["Pulse", "Sector Flow", "Screeners", "Watchlist"] as Tab[]).map((tab) => <button key={tab} onClick={() => onNavigate(tab)} className={`p-3 text-xs ${active === tab ? "text-[#b7f76b]" : "text-slate-400"}`}>{tab}{tab === "Sector Flow" && <ArrowUpRight size={10} className="ml-1 inline" />}</button>)}
      </nav>
    </header>
  );
}
