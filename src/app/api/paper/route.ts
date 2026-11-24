import { cookies } from "next/headers";
import { getDatabase } from "@/lib/db";
import { isAlgoState } from "@/lib/algo/storage";
import type { AlgoState } from "@/lib/algo/types";

export const dynamic = "force-dynamic";
const COOKIE = "marketpulse-paper";
const headers = { "Cache-Control": "no-store" };

async function identity(create: boolean) {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  if (!create) return null;
  const key = crypto.randomUUID();
  jar.set(COOKIE, key, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 31536000 });
  return key;
}

export async function GET() {
  const db = getDatabase();
  if (!db) return Response.json({ mode: "local", state: null }, { headers });
  const key = await identity(true);
  try {
    const { data: state, error } = await db.rpc("load_paper_state", { owner_key: key });
    if (error) throw error;
    if (!state) return Response.json({ mode: "supabase", state: null, userKey: key }, { headers });
    if (!isAlgoState(state)) throw new Error("Invalid stored paper state");
    return Response.json({ mode: "supabase", state, userKey: key }, { headers });
  } catch (error) {
    console.error("[paper] Supabase read failed", error);
    return Response.json({ error: "Cloud portfolio could not be loaded. Local backup is preserved; retry before trading." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const db = getDatabase();
  if (!db) return Response.json({ error: "Cloud persistence is not configured" }, { status: 503, headers });
  const key = await identity(false);
  if (!key) return Response.json({ error: "Browser session required" }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 5_000_000) return Response.json({ error: "Paper ledger is too large" }, { status: 413, headers });
  let state: AlgoState;
  let expectedRevision: number;
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object" || !("state" in input) || !("expectedRevision" in input) || !isAlgoState(input.state) || typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < -1) throw new Error("Invalid paper state");
    state = input.state;
    expectedRevision = input.expectedRevision;
    if (state.portfolio.user_key !== key || state.strategies.some((s) => s.user_key !== key)) throw new Error("Invalid owner");
  } catch (error) {
    console.warn("[paper] Rejected paper state", error);
    return Response.json({ error: "Invalid portfolio payload" }, { status: 400, headers });
  }
  const { data, error } = await db.rpc("save_paper_state", { owner_key: key, expected_revision: expectedRevision, state });
  if (error) {
    console.error("[paper] Save failed", error);
    return Response.json({ error: error.code === "40001" ? "Portfolio changed in another tab. Reload before trading." : "Cloud save failed. Your previous portfolio remains unchanged." }, { status: error.code === "40001" ? 409 : 503, headers });
  }
  return Response.json({ revision: data }, { headers });
}
