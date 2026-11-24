import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MarketSnapshot } from "./market.ts";

let client: SupabaseClient | undefined;
let memory: MarketSnapshot | null = null;

export function getDatabase() {
  if (typeof window !== "undefined") throw new Error("Database credentials are server-only");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  });
  return client;
}

export async function readSnapshot(): Promise<MarketSnapshot | null> {
  const db = getDatabase();
  if (!db) return memory;
  const { data, error } = await db.from("market_snapshots").select("payload").eq("id", "nse-latest").maybeSingle();
  if (error) {
    console.error("[snapshot] Supabase read failed; using process cache", error);
    return memory;
  }
  const payload = data?.payload;
  if (payload && Array.isArray(payload.stocks) && Array.isArray(payload.indices) && payload.coverage && payload.marketMood && payload.moneyRotation && typeof payload.fetchedAt === "string") {
    memory = payload;
  }
  return memory;
}

export async function writeSnapshot(snapshot: MarketSnapshot) {
  if (!snapshot.stocks.some((q) => q.price !== null)) return;
  memory = snapshot;
  const db = getDatabase();
  if (!db) return;
  const { error } = await db.rpc("save_market_snapshot", { snapshot });
  if (error) console.error("[snapshot] Supabase write failed; observations remain in process memory", error);
}
