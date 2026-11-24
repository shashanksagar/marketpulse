import { after } from "next/server";
import { INSTRUMENTS } from "@/lib/market";
import { getInstrumentHistory, getMarketData } from "@/lib/marketData/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "^NSEI").trim().toUpperCase();
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument) return Response.json({ error: "Unsupported NSE symbol." }, { status: 400 });
  try {
    if (params.get("history") === "true") {
      const history = await getInstrumentHistory(instrument);
      return Response.json(history, { headers: { "Cache-Control": "no-store" } });
    }
    const data = await getMarketData(instrument, params.get("refresh") === "true", after, params.get("history") === "true");
    return Response.json(data, { headers: { "Cache-Control": "no-store", "X-Market-Cache": data.snapshotStatus === "cached" ? "STALE" : "HIT" } });
  } catch (error) {
    console.error("[market-data] Failed to assemble dashboard", error);
    return Response.json({ error: "Market data unavailable. Previously saved observations are retained." }, { status: 503 });
  }
}
