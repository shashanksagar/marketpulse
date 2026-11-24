import { INSTRUMENTS } from "@/lib/market";
import { getBacktestContext } from "@/lib/marketData/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "RELIANCE.NS";
  if (!INSTRUMENTS.some((i) => i.symbol === symbol && i.sector !== null)) return Response.json({ error: "Unsupported NSE equity" }, { status: 400 });
  try {
    return Response.json(await getBacktestContext(symbol), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[backtest] Historical market context unavailable", error);
    return Response.json({ error: "Historical market context unavailable. Retry when providers recover." }, { status: 503 });
  }
}
