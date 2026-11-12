"use client";

import { useMemo, useSyncExternalStore } from "react";

const KEY = "market-pulse-watchlist";
const EVENT = "market-pulse-watchlist-change";
let sessionValue = "[]";
let storageFailed = false;
const listeners = new Set<() => void>();

function snapshot() {
  try { return storageFailed ? sessionValue : localStorage.getItem(KEY) ?? "[]"; }
  catch (error) {
    console.warn("Watchlist storage is unavailable", error);
    storageFailed = true;
    return sessionValue;
  }
}
function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}
function serverSnapshot() { return "[]"; }
function errorSnapshot() { return storageFailed; }
function serverErrorSnapshot() { return false; }

export function useWatchlist() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const failed = useSyncExternalStore(subscribe, errorSnapshot, serverErrorSnapshot);
  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Invalid watchlist");
      return { values: value, invalid: false };
    } catch (error) {
      console.warn("Stored watchlist is invalid", error);
      return { values: [], invalid: true };
    }
  }, [raw]);
  function toggle(symbol: string) {
    const list = parsed.values;
    sessionValue = JSON.stringify(list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol]);
    try { localStorage.setItem(KEY, sessionValue); }
    catch (error) {
      console.warn("Could not save watchlist", error);
      storageFailed = true;
    }
    for (const listener of listeners) listener();
  }
  return {
    watchlist: parsed.values, toggle,
    storageError: failed ? "Browser storage is unavailable. Watchlist changes are session-only." : parsed.invalid ? "Stored watchlist is invalid. Star a stock to start a new list." : "",
  };
}
