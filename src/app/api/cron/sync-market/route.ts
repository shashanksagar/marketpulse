import { timingSafeEqual } from "node:crypto";
import { refreshSnapshot } from "@/lib/marketData/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const token = `Bearer ${expected}`;
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const snapshot = await refreshSnapshot();
    return Response.json({ coverage: snapshot.coverage, status: snapshot.snapshotStatus, fetchedAt: snapshot.fetchedAt }, { status: snapshot.coverage.observed ? 200 : 503 });
  } catch (error) {
    console.error("[cron] Market sync failed", error);
    return Response.json({ error: "Market sync failed" }, { status: 503 });
  }
}
