"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ArrowUpRight, ChartCandlestick, Search, X } from "lucide-react";
import { INSTRUMENTS, ticker } from "@/lib/market";

export default function CommandPalette({ open, onClose, onSelect }: {
  open: boolean; onClose: () => void; onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const results = INSTRUMENTS.filter((i) => `${i.symbol} ${i.name}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  useEffect(() => {
    dialogRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!open) return null;
  const select = (symbol: string) => { onSelect(symbol); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[15vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search NSE symbols" className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#343c48] bg-[#11161f] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => results.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0);
          }
          if (event.key === "Enter" && results[active]) { event.preventDefault(); select(results[active].symbol); }
          if (event.key === "Tab") {
            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("input, button");
            if (!focusable?.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <div className="flex items-center gap-3 border-b border-[#29303b] px-5 py-4">
          <Search size={20} className="text-[#b7f76b]" />
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} aria-label="Search by company or symbol" placeholder="Search a company or NSE symbol..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500" />
          <button onClick={onClose} aria-label="Close search" className="rounded p-1 text-slate-400 hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="px-5 pb-2 pt-4 text-[10px] font-semibold tracking-[0.16em] text-slate-500">INDICES & NSE EQUITIES</div>
        <div className="max-h-[45vh] overflow-y-auto p-2" role="listbox" aria-label="Available symbols">
          {results.map((item, index) => <button key={item.symbol} role="option" aria-selected={index === active} data-index={index} onClick={() => select(item.symbol)} onFocus={() => setActive(index)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ${index === active ? "bg-[#202b20]" : "hover:bg-[#1b222d]"}`}>
            <span className="rounded-lg bg-[#28322a] p-2 text-[#b7f76b]"><ChartCandlestick size={17} /></span>
            <span className="flex-1"><span className="block text-sm font-medium">{item.name}</span><span className="font-mono text-[11px] text-slate-500">{ticker(item.symbol)} · NSE</span></span>
            <ArrowUpRight size={16} className="text-slate-500" />
          </button>)}
          {!results.length && <p className="p-8 text-center text-sm text-slate-400">No matching symbols in the tracked universe.</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-[#29303b] p-3 text-[11px] text-slate-500"><ArrowDownUp size={12} /> Navigate <span className="ml-3">Enter to select</span><span className="ml-auto">Esc to close</span></div>
      </div>
    </div>
  );
}
