import assert from "node:assert/strict";
import test from "node:test";
import { buildMoneyRotation, createInitialData, INSTRUMENTS, normalizeQuote, ROTATION_INDICES } from "../src/lib/market.ts";
import { fetchQuoteChunks } from "../src/lib/quoteBatch.ts";
import { preserveQuotes, recoverChartQuotes, retry, fetchNseQuotes } from "../src/lib/marketData/fallback.ts";
import { mergeMarketData, cachedData } from "../src/lib/marketData/clientSnapshot.ts";
import { readSnapshot, writeSnapshot } from "../src/lib/db.ts";

const now = new Date("2026-11-24T05:00:00Z");
const input = (symbol, price = 100) => ({ symbol, regularMarketPrice: price, regularMarketPreviousClose: 99, regularMarketTime: now });

test("failed and partial Yahoo batches preserve persisted per-symbol observations, not N/A", async () => {
  const instruments = INSTRUMENTS.slice(3, 63);
  const previous = instruments.map((i) => normalizeQuote(i, input(i.symbol)));
  const result = await fetchQuoteChunks(instruments.map((i) => i.symbol), async (chunk) => {
    if (chunk[0] === instruments[25].symbol) throw new Error("429");
    return chunk.slice(0, -1).map((symbol) => input(symbol, 101));
  }, async () => {});
  const raw = new Map(result.quotes.map((q) => [q.symbol, q]));
  const merged = preserveQuotes(instruments.map((i) => normalizeQuote(i, raw.get(i.symbol))), previous);
  assert.equal(result.failures.length, 1);
  assert.ok(merged.every((q) => q.price !== null));
  assert.equal(merged[25].price, 100);
  assert.equal(merged[25].cached, true);
  assert.equal(merged[0].price, 101);
  assert.equal(merged[0].cached, false);
  assert.equal(merged[24].observedAt, now.toISOString());
  assert.equal(preserveQuotes([normalizeQuote(instruments[0])])[0].price, null);
  const older = normalizeQuote(instruments[0], { ...input(instruments[0].symbol, 90), regularMarketTime: new Date("2026-11-23T05:00:00Z") });
  assert.equal(preserveQuotes([older], previous)[0].price, 100);
});

test("stored server and browser snapshots survive a total upstream failure with original provenance", async () => {
  const saved = createInitialData("RELIANCE.NS", now);
  saved.stocks = saved.stocks.map((q) => normalizeQuote(q, input(q.symbol)));
  saved.quote = saved.stocks[0];
  saved.source = "mixed";
  await writeSnapshot(saved);
  assert.equal((await readSnapshot()).stocks[0].price, 100);
  const merged = mergeMarketData(createInitialData("RELIANCE.NS"), JSON.parse(JSON.stringify(saved)));
  assert.equal(merged.stocks[0].price, 100);
  assert.equal(merged.snapshotStatus, "cached");
  assert.equal(merged.fetchedAt, now.toISOString());
  assert.equal(merged.quote.cached, true);
  assert.equal(cachedData(saved, "TCS.NS").quote.symbol, "TCS.NS");
});

test("retry backs off only transient failures and stops at three attempts", async () => {
  const waits = [];
  let attempts = 0;
  assert.equal(await retry(async () => { if (++attempts < 3) throw new Error("429 rate limit"); return "ok"; }, new AbortController().signal, async (ms) => waits.push(ms)), "ok");
  assert.equal(attempts, 3);
  assert.ok(waits[0] >= 400 && waits[1] >= 800);
  attempts = 0;
  await assert.rejects(retry(async () => { attempts++; throw new Error("Invalid symbol"); }, new AbortController().signal), /Invalid symbol/);
  assert.equal(attempts, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(retry(async () => "never", controller.signal));
});

test("chart recovery handles every missing symbol with three bounded workers and observed averages", async () => {
  let active = 0, peak = 0;
  const symbols = Array.from({ length: 28 }, (_, i) => `TEST${i}.NS`);
  const result = await recoverChartQuotes(symbols, async () => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return { meta: { regularMarketPrice: 110, regularMarketTime: now }, quotes: Array.from({ length: 11 }, (_, i) => ({ date: new Date(now.getTime() - (10 - i) * 86400_000), open: 100, close: 100 + i, high: 112, low: 98, volume: 1000 })) };
  }, new AbortController().signal, async () => {});
  assert.equal(result.quotes.length, 28);
  assert.equal(result.failures.length, 0);
  assert.equal(peak, 3);
  assert.equal(result.quotes[0].regularMarketPreviousClose, 109);
  assert.equal(result.quotes[0].averageDailyVolume10Day, 1000);
});

test("chart-recovered sector indices retain observed daily changes for money rotation", async () => {
  const result = await recoverChartQuotes(ROTATION_INDICES.map((index) => index.symbol), async () => ({
    meta: { regularMarketPrice: 110, regularMarketTime: now },
    quotes: [
      { date: new Date("2026-11-23T00:00:00Z"), open: 100, close: 109, high: 110, low: 99, volume: 1000 },
      { date: new Date("2026-11-24T00:00:00Z"), open: 109, close: 110, high: 111, low: 108, volume: 1200 },
    ],
  }), new AbortController().signal, async () => {});

  const rotation = buildMoneyRotation(result.quotes);
  assert.equal(rotation.sectors.length, ROTATION_INDICES.length);
  assert.equal(rotation.unavailable.length, 0);
  assert.ok(rotation.sectors.every((sector) => Math.abs(sector.changePercent - (110 - 109) / 109 * 100) < 1e-10));
});

test("NSE fallback warms cookies and returns only observed requested equity prices", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return new Response("", { headers: { "Set-Cookie": "nse_session=observed; Path=/" } });
    return Response.json({ timestamp: "24-Nov-2026 10:30:00", data: [{ symbol: "RELIANCE", lastPrice: 1500, previousClose: 1490, totalTradedVolume: 100 }, { symbol: "TCS", lastPrice: 0 }] });
  });
  const quotes = await fetchNseQuotes(["RELIANCE.NS", "TCS.NS", "^NSEI"], new AbortController().signal);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Cookie, "nse_session=observed");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].regularMarketPrice, 1500);
  assert.equal(quotes[0].provider, "nse");
  assert.equal(quotes[0].regularMarketTime.toISOString(), now.toISOString());
});
