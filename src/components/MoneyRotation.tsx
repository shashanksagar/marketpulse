"use client";

import { useId, useState } from "react";
import { ArrowRightLeft, Info, X } from "lucide-react";
import { percent, type MoneyRotationData, type RotationNode, type RotationSector, type Sector } from "@/lib/market";

function crore(value: number | null) {
  if (value === null) return "N/A";
  return `${value < 0 ? "-" : "+"}\u20b9${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
}

export default function MoneyRotation({ data, selectedSector, onSectorSelect }: {
  data: MoneyRotationData;
  selectedSector: Sector | null;
  onSectorSelect: (sector: Sector | null) => void;
}) {
  const gradientId = useId();
  const tooltipId = useId();
  const [hovered, setHovered] = useState<RotationSector | null>(null);
  const active = hovered ?? selectedSector;
  const height = Math.max(3, data.leaving.length, data.arriving.length) * 84;
  const nodeY = (index: number, count: number) => (index + 0.5) * height / count;
  const totalFor = (name: RotationSector) => data.links.reduce((sum, link) => sum + (link.from === name || link.to === name ? link.valueCr : 0), 0);
  const maxTotal = Math.max(1, ...data.sectors.map((node) => totalFor(node.name)));
  const scale = 48 / maxTotal;
  const offsets = new Map<string, number>();
  const paths = data.links.map((link) => {
    const fromIndex = data.leaving.findIndex((node) => node.name === link.from);
    const toIndex = data.arriving.findIndex((node) => node.name === link.to);
    const width = link.valueCr * scale;
    const leftKey = `left-${link.from}`, rightKey = `right-${link.to}`;
    const leftOffset = offsets.get(leftKey) ?? 0, rightOffset = offsets.get(rightKey) ?? 0;
    const y1 = nodeY(fromIndex, data.leaving.length) - totalFor(link.from) * scale / 2 + leftOffset + width / 2;
    const y2 = nodeY(toIndex, data.arriving.length) - totalFor(link.to) * scale / 2 + rightOffset + width / 2;
    offsets.set(leftKey, leftOffset + width);
    offsets.set(rightKey, rightOffset + width);
    return { ...link, width, path: `M 0 ${y1} C 420 ${y1}, 580 ${y2}, 1000 ${y2}` };
  });
  const tooltipNode = data.sectors.find((node) => node.name === hovered);
  const tooltipOnLeft = !!tooltipNode && tooltipNode.flowCr < 0;
  const tooltipList = tooltipOnLeft ? data.leaving : data.arriving;
  const tooltipY = tooltipNode ? nodeY(Math.max(0, tooltipList.findIndex((node) => node.name === hovered)), Math.max(1, tooltipList.length)) : 0;

  function nodeButton(node: RotationNode, index: number, count: number, leaving: boolean) {
    const connected = active === node.name || data.links.some((link) => (link.from === active && link.to === node.name) || (link.to === active && link.from === node.name));
    return (
      <button key={node.name}
        aria-label={`Filter scanner by ${node.name}`}
        aria-pressed={selectedSector === node.name}
        aria-describedby={hovered === node.name ? tooltipId : undefined}
        onMouseEnter={() => setHovered(node.name)} onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(node.name)} onBlur={() => setHovered(null)}
        onKeyDown={(event) => { if (event.key === "Escape") setHovered(null); }}
        onClick={() => onSectorSelect(selectedSector === node.name ? null : node.name)}
        className={`absolute z-10 flex h-[76px] w-[28%] -translate-y-1/2 flex-col justify-center rounded-xl border bg-[#131824] px-2 text-left transition-[border-color,opacity,box-shadow] sm:w-1/4 sm:px-4 ${leaving ? "left-0 border-rose-500/25 hover:border-rose-400/70" : "right-0 border-emerald-500/25 hover:border-emerald-400/70"} ${active && !connected ? "opacity-40" : "opacity-100"} ${selectedSector === node.name ? "ring-1 ring-slate-400/60" : ""}`}
        style={{ top: nodeY(index, count) }}>
        <span className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-200 sm:text-sm">
          {node.name}<span className={`hidden size-1.5 rounded-full sm:block ${leaving ? "bg-rose-400" : "bg-emerald-400"}`} />
        </span>
        <span className={`mt-1 font-mono text-[10px] tabular-nums sm:text-xs ${leaving ? "text-rose-400" : "text-emerald-400"}`}>{percent(node.changePercent)} <span className="hidden text-[8px] uppercase text-slate-500 sm:inline">/ {node.source}</span></span>
        <span className="mt-1 whitespace-nowrap font-mono text-[9px] tabular-nums text-slate-400 sm:text-[11px]">{crore(node.flowCr)}</span>
      </button>
    );
  }

  return (
    <section id="money-rotation" className="panel flex min-w-0 scroll-mt-24 flex-col" aria-labelledby="rotation-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252b36] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="rotation-title" className="flex items-center gap-2 text-sm font-semibold"><ArrowRightLeft size={16} className="text-slate-400" /> Money rotation</h2>
          <span className="rounded-full border border-[#303947] bg-[#171e29] px-2.5 py-1 text-[9px] text-slate-400">Sector Capital Flow · NSE Delayed</span>
        </div>
        <span className={`rounded border px-2 py-1 text-[9px] uppercase tracking-wide ${data.source === "yahoo" ? "border-emerald-500/20 text-emerald-400" : "border-amber-500/20 text-amber-300/80"}`}>{data.source === "unavailable" ? "Data unavailable" : data.source === "mixed" ? "Partial / modeled inputs" : "Yahoo inputs"} · Estimated flows</span>
      </div>
      <div className="flex-1 px-3 pb-3 pt-5 sm:px-5">
        <div className="grid grid-cols-[28%_44%_28%] text-[10px] text-slate-400 sm:grid-cols-[25%_50%_25%] sm:text-xs">
          <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-rose-500" />Leaving</span>
          <span className="text-center text-slate-500">Net flow <span className={`mt-1 block font-mono text-[9px] tabular-nums sm:ml-2 sm:inline sm:text-xs ${data.netCr === null ? "text-slate-500" : data.netCr >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{crore(data.netCr)}</span></span>
          <span className="flex items-center justify-end gap-2">Arriving<span className="size-1.5 rounded-full bg-emerald-500" /></span>
        </div>
        <div className="relative mt-3" style={{ height }} data-testid="money-rotation-diagram">
          <svg className="pointer-events-none absolute inset-y-0 left-[28%] h-full w-[44%] sm:left-1/4 sm:w-1/2"
            viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" role="img" aria-label="Estimated sector rotation ribbons; not observed capital transfers">
            <defs><linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f43f5e" /><stop offset="100%" stopColor="#10b981" /></linearGradient></defs>
            {paths.map((link) => <path key={`${link.from}-${link.to}`} d={link.path} fill="none" stroke={`url(#${gradientId})`}
              strokeWidth={link.width} opacity={active ? link.from === active || link.to === active ? 0.65 : 0.04 : 0.22}
              className="transition-opacity duration-200" data-from={link.from} data-to={link.to}>
              <title>{`${link.from} to ${link.to}: ${crore(link.valueCr)} estimated matched proxy`}</title>
            </path>)}
          </svg>
          {data.leaving.map((node, index) => nodeButton(node, index, data.leaving.length, true))}
          {data.arriving.map((node, index) => nodeButton(node, index, data.arriving.length, false))}
          {!data.leaving.length && <p className="absolute left-0 top-1/2 w-[28%] text-center text-[10px] leading-relaxed text-slate-500 sm:w-1/4">No sectors leaving</p>}
          {!data.arriving.length && <p className="absolute right-0 top-1/2 w-[28%] text-center text-[10px] leading-relaxed text-slate-500 sm:w-1/4">No sectors arriving</p>}
          {!data.links.length && <p className="absolute left-[30%] top-1/2 w-[40%] -translate-y-1/2 text-center text-[10px] leading-relaxed text-slate-500">No opposing flows to pair.<br />No transfers inferred.</p>}
          {tooltipNode && <div id={tooltipId} role="tooltip"
            className={`pointer-events-none absolute z-20 w-[72%] max-w-80 rounded-xl border border-slate-600/60 bg-[#101721]/95 p-3 text-[10px] shadow-2xl backdrop-blur-xl ${tooltipOnLeft ? "left-0" : "right-0"}`}
            style={{ top: Math.max(0, Math.min(height - 154, tooltipY + 40)) }}>
            <div className="mb-2 flex justify-between gap-2 font-semibold text-slate-200"><span>{tooltipNode.name}</span><span className="uppercase text-slate-500">{tooltipNode.source}</span></div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-400">
              <dt>Daily change</dt><dd className="text-right font-mono tabular-nums">{percent(tooltipNode.changePercent)}</dd>
              <dt>Volume / weight</dt><dd className="text-right font-mono tabular-nums">{tooltipNode.volume.toLocaleString("en-IN")} / {(tooltipNode.volumeWeight * 100).toFixed(2)}%</dd>
              <dt>Estimated flow</dt><dd className="text-right font-mono tabular-nums">{crore(tooltipNode.flowCr)}</dd>
              <dt>Matched ribbons</dt><dd className="text-right font-mono tabular-nums">{crore(totalFor(tooltipNode.name))}</dd>
            </dl>
            <p className="mt-2 text-[9px] text-slate-500">{tooltipNode.symbol} · {tooltipNode.asOf}{tooltipNode.fallbackFields.length > 0 && ` · Modeled/missing: ${tooltipNode.fallbackFields.join(", ")}`}</p>
          </div>}
        </div>
        {data.unavailable.length > 0 && <p className="mt-3 text-[10px] text-slate-500">N/A — missing sector changes: {data.unavailable.map((node) => node.name).join(", ")}. Excluded from estimated flows.</p>}
        {data.neutral.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">Unchanged:
          {data.neutral.map((node) => <button key={node.name} onClick={() => onSectorSelect(selectedSector === node.name ? null : node.name)} aria-pressed={selectedSector === node.name} className="rounded border border-slate-700 px-2 py-1">{node.name} <span className="font-mono tabular-nums">0.00%</span></button>)}
        </div>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#252b36] pt-3 text-[10px] text-slate-500">
          <span>Hover or focus to trace connections. Select a sector to filter the scanner.</span>
          {selectedSector && <button onClick={() => onSectorSelect(null)} className="flex items-center gap-1 rounded bg-[#252e24] px-2 py-1 text-[#b7df8c]" aria-label="Clear rotation sector filter">{selectedSector}<X size={11} /></button>}
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-b-xl border-t border-[#252b36] bg-[#0d1118] px-4 py-3 text-[9px] leading-relaxed text-slate-500 sm:px-5"><Info size={12} className="mt-px shrink-0" /><p>Estimated proxy = daily change × relative index volume × an assumed <span className="font-mono tabular-nums">₹{data.notionalCr.toLocaleString("en-IN")} Cr</span> notional. Not actual traded rupees or capital transfers. Ribbons pair only the smaller aggregate inflow/outflow; the unmatched balance is excluded. Zero/missing index volume uses a labeled illustrative weight.</p></div>
    </section>
  );
}
