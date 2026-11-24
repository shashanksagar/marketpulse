"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function AlgoDialog({ title, onClose, children, drawer = false }: { title: string; onClose: () => void; children: ReactNode; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger instanceof HTMLElement) trigger.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={title} className={`${drawer ? "fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-2xl" : "fixed m-auto w-[min(95vw,560px)] rounded-xl"} overflow-y-auto border border-slate-700 bg-[#10141c] p-6 text-slate-100 backdrop:bg-black/70`}>
    <header className="mb-5 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label={`Close ${title}`} className="rounded border border-slate-600 px-3 py-1 text-sm">Close</button></header>
    {children}
  </dialog>;
}
