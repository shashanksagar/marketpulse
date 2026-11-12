import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUMENTS, ROTATION_INDICES, buildMoneyRotation, computeMarketMood, computeSignal, createInitialData, decimal, moodRegime, normalizeQuote, percent, price, rangePosition, summarize } from "../src/lib/market.ts";
import { FNO_STOCKS, STOCK_SECTORS } from "../src/data/fnoStocks.ts";
import { fetchQuoteChunks } from "../src/lib/quoteBatch.ts";

const now = new Date("2026-11-12T08:00:00Z");
const instrument = INSTRUMENTS.find((item) => item.symbol === "RELIANCE.NS");
const validQuote = () => ({
  symbol: instrument.symbol, regularMarketPrice: 110, regularMarketPreviousClose: 100,
  regularMarketOpen: 101, regularMarketDayHigh: 112, regularMarketDayLow: 98,
  regularMarketVolume: 3000, averageDailyVolume10Day: 1000, averageDailyVolume3Month: 1500,
  regularMarketTime: now,
});
const rotationQuotes = () => ROTATION_INDICES.map((index, i) => ({
  symbol: index.symbol, regularMarketChangePercent: i % 2 ? -(i + 1) / 10 : (i + 1) / 10,
  regularMarketVolume: index.volume, regularMarketTime: now,
}));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);

test("signal quadrants preserve thresholds; unknown inputs never create a signal", () => {
  for (const [change, ratio, expected] of [[1, 1, "Long Buildup"], [1, 0.99, "Short Covering"], [-1, 1, "Short Buildup"], [-1, 0.99, "Long Unwinding"], [0, 1, "Neutral"], [1, 0, "Neutral"]]) {
    assert.equal(computeSignal(change, ratio), expected);
  }
  for (const value of [null, NaN, Infinity]) {
    assert.equal(computeSignal(value, 1), null);
    assert.equal(computeSignal(1, value), null);
  }
});

test("startup and outage payloads contain no fabricated prices or candles", () => {
  for (const selected of INSTRUMENTS) {
    const data = createInitialData(selected.symbol, now);
    assert.equal(data.symbol, selected.symbol);
    assert.equal(data.quote.symbol, selected.symbol);
    assert.equal(data.indices.length, 3);
    assert.equal(data.stocks.length, FNO_STOCKS.length);
    assert.equal(data.source, "unavailable");
    assert.equal(data.candleSource, "unavailable");
    assert.deepEqual(data.candles, []);
    assert.equal(data.moneyRotation.source, "unavailable");
    assert.equal(data.moneyRotation.netCr, null);
    assert.equal(data.moneyRotation.unavailable.length, 8);
    assert.equal(data.marketMood.score, null);
    assert.equal(data.marketMood.indiaVix.value, null);
    assert.deepEqual(data.breadth, { advances: 0, declines: 0, unchanged: 0 });
    assert.equal(data.coverage.unavailable, FNO_STOCKS.length);
    assert.ok(data.sectors.every((sector) => sector.count === 0 && sector.change === null));
    assert.ok([...data.stocks, ...data.indices].every((q) => q.price === null && q.signal === null));
  }
});

test("formatters render null and nonfinite fields as N/A, including suffixes", () => {
  for (const value of [null, NaN, Infinity, -Infinity]) {
    assert.equal(price(value), "N/A");
    assert.equal(percent(value), "N/A");
    assert.equal(decimal(value, 2, "x"), "N/A");
  }
  assert.equal(price(2214), "2,214.00");
  assert.equal(percent(0), "+0.00%");
  assert.equal(decimal(0, 2, "M"), "0.00M");
});

test("universe contains unique current NSE symbols and complete sector tags", () => {
  assert.ok(FNO_STOCKS.length >= 180);
  assert.equal(new Set(FNO_STOCKS.map((stock) => stock.symbol)).size, FNO_STOCKS.length);
  assert.equal(new Set(INSTRUMENTS.map((stock) => stock.symbol)).size, INSTRUMENTS.length);
  for (const stock of FNO_STOCKS) {
    assert.match(stock.symbol, /^[A-Z0-9&-]+\.NS$/);
    assert.ok(stock.name.length > 1);
    assert.ok(STOCK_SECTORS.includes(stock.sector));
  }
  for (const sector of STOCK_SECTORS) assert.ok(FNO_STOCKS.some((stock) => stock.sector === sector));
  for (const symbol of ["RELIANCE.NS", "POLICYBZR.NS", "M&M.NS", "BAJAJ-AUTO.NS", "SUNPHARMA.NS", "POWERINDIA.NS", "GVT&D.NS", "360ONE.NS", "ETERNAL.NS", "GMRAIRPORT.NS", "ABREL.NS", "PVRINOX.NS", "LTM.NS", "ICICILIFE.NS", "UNITDSPR.NS", "CCAVENUE.NS", "PIRAMALFIN.NS"]) {
    assert.ok(FNO_STOCKS.some((stock) => stock.symbol === symbol), symbol);
  }
  for (const symbol of ["TATAMOTORS.NS", "ZOMATO.NS", "GMRINFRA.NS", "CENTURYTEX.NS", "LTIM.NS", "ICICIPRULI.NS", "MCDOWELL-N.NS", "INFIBEAM.NS", "PEL.NS"]) {
    assert.ok(!INSTRUMENTS.some((stock) => stock.symbol === symbol), symbol);
  }
  for (const [symbol, name] of [["TMPV.NS", "Tata Motors Passenger Vehicles"], ["TMCV.NS", "Tata Motors Commercial Vehicles"]]) {
    assert.deepEqual(FNO_STOCKS.find((stock) => stock.symbol === symbol), { symbol, name, sector: "Auto" });
  }
});

test("real quote normalization prefers 10D then 3M, with exact derived fields", () => {
  const quote = normalizeQuote(instrument, validQuote());
  assert.equal(quote.source, "yahoo");
  assert.equal(quote.price, 110);
  assert.equal(quote.change, 10);
  assert.equal(quote.changePercent, 10);
  assert.equal(quote.avgVolume, 1000);
  assert.equal(quote.averageVolume, 1000);
  assert.equal(quote.volumeRatio, 3);
  assert.equal(quote.dayHigh, 112);
  near(quote.rangePosition, 12 / 14);
  assert.equal(quote.signal, "Long Buildup");
  assert.deepEqual(quote.missingFields, []);
  const threeMonth = normalizeQuote(instrument, { ...validQuote(), averageDailyVolume10Day: 0 });
  assert.equal(threeMonth.avgVolume, 1500);
  assert.equal(threeMonth.source, "yahoo");
});

test("failed or invalid prices null all dependent observations instead of using a base price", () => {
  for (const value of [undefined, NaN, Infinity, 0, -1]) {
    const quote = normalizeQuote(instrument, { ...validQuote(), regularMarketPrice: value });
    assert.equal(quote.source, "unavailable");
    for (const key of ["price", "change", "changePercent", "open", "high", "low", "volume", "avgVolume", "averageVolume", "volumeRatio", "dayHigh", "dayLow", "rangePosition", "signal", "asOf"]) assert.equal(quote[key], null, key);
    assert.ok(quote.missingFields.includes("price"));
  }
  assert.equal(normalizeQuote(instrument).price, null);
});

test("partial quotes preserve valid observations without fabricated volume, range or date", () => {
  const partial = normalizeQuote(instrument, { ...validQuote(), averageDailyVolume10Day: undefined, averageDailyVolume3Month: NaN, regularMarketDayLow: undefined, regularMarketVolume: -1, regularMarketTime: new Date("invalid") });
  assert.equal(partial.source, "mixed");
  assert.equal(partial.price, 110);
  for (const key of ["high", "low", "volume", "averageVolume", "volumeRatio", "rangePosition", "signal", "asOf"]) assert.equal(partial[key], null, key);
  assert.deepEqual(partial.missingFields, ["high", "low", "volume", "averageVolume", "asOf"]);
  const noChange = normalizeQuote(instrument, { ...validQuote(), regularMarketPreviousClose: undefined });
  assert.equal(noChange.price, 110);
  assert.equal(noChange.changePercent, null);
  assert.equal(noChange.signal, null);
  assert.equal(noChange.source, "mixed");
  const suppliedChange = normalizeQuote(instrument, { ...validQuote(), regularMarketPreviousClose: undefined, regularMarketChange: 5, regularMarketChangePercent: 4.76 });
  assert.equal(suppliedChange.source, "yahoo");
});

test("real zero volume and flat sessions remain neutral and bounded", () => {
  const q = normalizeQuote(instrument, { ...validQuote(), regularMarketPrice: 100, regularMarketPreviousClose: 100, regularMarketDayHigh: 100, regularMarketDayLow: 100, regularMarketOpen: 100, regularMarketVolume: 0 });
  assert.equal(q.rangePosition, 0.5);
  assert.equal(q.volumeRatio, 0);
  assert.equal(q.signal, "Neutral");
  assert.equal(q.source, "yahoo");
  assert.equal(rangePosition(200, 90, 110), 1);
  assert.equal(rangePosition(0, 90, 110), 0);
});

test("breadth and sector averages exclude missing price or change, not treat them as flat", () => {
  const template = normalizeQuote(instrument, validQuote());
  const stocks = [1, 1, -1, 0].map((changePercent) => ({ ...template, changePercent }));
  stocks.push(normalizeQuote(instrument), { ...template, changePercent: null });
  const { breadth, sectors } = summarize(stocks);
  assert.deepEqual(breadth, { advances: 2, declines: 1, unchanged: 1 });
  assert.deepEqual(sectors.find((s) => s.name === instrument.sector), { name: instrument.sector, change: 0.25, count: 4 });
  assert.ok(sectors.filter((s) => s.name !== instrument.sector).every((s) => s.change === null && s.count === 0));
});

test("mood implements weighted formula using observed breadth and exact breakout threshold", () => {
  const template = normalizeQuote(instrument, validQuote());
  const stocks = [
    { ...template, changePercent: 1, volumeRatio: 2.01, rangePosition: 0.8 },
    { ...template, changePercent: -1, volumeRatio: 3, rangePosition: 0.9 },
    { ...template, changePercent: 0, volumeRatio: 3, rangePosition: 0.9 },
    { ...template, changePercent: 1, volumeRatio: 2, rangePosition: 0.9 },
    normalizeQuote(instrument),
  ];
  const mood = computeMarketMood(stocks, { ...template, changePercent: 1.5 }, { value: 20, source: "yahoo", asOf: "2026-11-12" });
  near(mood.components.breadth, 62.5);
  near(mood.components.nifty, 75);
  near(mood.components.vix, 60);
  assert.equal(mood.score, Math.round(62.5 * 0.45 + 75 * 0.3 + 60 * 0.25));
  assert.equal(mood.highVolumeBreakouts, 1);
  assert.deepEqual(mood.breadth, { advances: 2, declines: 1, unchanged: 1, sample: 4, observed: 4, total: 5 });
  assert.equal(mood.source, "mixed");
});

test("mood requires observed breadth, NIFTY change and VIX rather than substituting demo inputs", () => {
  const quote = normalizeQuote(instrument, validQuote());
  const vix = { value: 20, source: "yahoo", asOf: "2026-11-12" };
  for (const mood of [
    computeMarketMood([quote], quote, { value: null, source: "unavailable", asOf: null }),
    computeMarketMood([quote], normalizeQuote(instrument), vix),
    computeMarketMood([normalizeQuote(instrument)], quote, vix),
  ]) {
    assert.equal(mood.score, null);
    assert.equal(mood.source, "unavailable");
    assert.equal(mood.riskLabel, "N/A");
  }
  assert.equal(computeMarketMood([{ ...quote, volumeRatio: null }], quote, vix).highVolumeBreakouts, null);
});

test("mood regime boundaries and extreme input clamping remain exact", () => {
  for (const [value, regime] of [[0, "Extreme Fear"], [25, "Extreme Fear"], [26, "Cautious"], [44, "Cautious"], [45, "Neutral"], [55, "Neutral"], [56, "Constructive"], [74, "Constructive"], [75, "Euphoria"], [100, "Euphoria"]]) assert.equal(moodRegime(value).regime, regime);
  const quote = normalizeQuote(instrument, validQuote());
  assert.equal(computeMarketMood([quote], { ...quote, changePercent: 10 }, { value: 5, source: "yahoo", asOf: "2026-11-12" }).score, 100);
  assert.equal(computeMarketMood([{ ...quote, changePercent: -10 }], { ...quote, changePercent: -10 }, { value: 70, source: "yahoo", asOf: "2026-11-12" }).score, 0);
});

test("rotation uses all eight sector indices and exact volume-weighted signed scores", () => {
  const inputs = rotationQuotes(), data = buildMoneyRotation(inputs);
  assert.equal(data.source, "yahoo");
  assert.equal(data.leaving.length, 4);
  assert.equal(data.arriving.length, 4);
  assert.equal(data.links.length, 16);
  near(data.sectors.reduce((sum, node) => sum + node.volumeWeight, 0), 1);
  const totalVolume = inputs.reduce((sum, q) => sum + q.regularMarketVolume, 0);
  for (const node of data.sectors) {
    const input = inputs.find((q) => q.symbol === node.symbol);
    near(node.volumeWeight, input.regularMarketVolume / totalVolume);
    near(node.flowCr, input.regularMarketChangePercent / 100 * node.volumeWeight * data.notionalCr);
    assert.deepEqual(node.fallbackFields, []);
  }
  near(data.netCr, data.sectors.reduce((sum, node) => sum + node.flowCr, 0));
});

test("ribbons conserve matched flow on both sides without exceeding any node", () => {
  const data = buildMoneyRotation(rotationQuotes());
  const outflow = -data.leaving.reduce((sum, node) => sum + node.flowCr, 0);
  const inflow = data.arriving.reduce((sum, node) => sum + node.flowCr, 0);
  near(data.matchedCr, Math.min(inflow, outflow));
  near(data.links.reduce((sum, link) => sum + link.valueCr, 0), data.matchedCr);
  for (const node of data.sectors) {
    const linked = data.links.filter((link) => link.from === node.name || link.to === node.name).reduce((sum, link) => sum + link.valueCr, 0);
    near(linked, Math.abs(node.flowCr) / (node.flowCr < 0 ? outflow : inflow) * data.matchedCr);
    assert.ok(linked <= Math.abs(node.flowCr) + 1e-8);
  }
});

test("missing sector changes are excluded; only volume weights may be explicitly modeled", () => {
  const inputs = rotationQuotes();
  inputs[0].regularMarketVolume = 0;
  inputs[1].regularMarketChangePercent = NaN;
  inputs[2].regularMarketVolume = -1;
  inputs[3].regularMarketVolume = Infinity;
  inputs[4].regularMarketTime = new Date("invalid");
  inputs.pop();
  const data = buildMoneyRotation(inputs);
  assert.equal(data.source, "mixed");
  assert.equal(data.sectors.length, 6);
  assert.deepEqual(data.unavailable.map((node) => node.name), ["IT", "Infra"]);
  assert.deepEqual(data.sectors[0].fallbackFields, ["volume weight"]);
  assert.deepEqual(data.sectors.find((node) => node.name === "FMCG").fallbackFields, ["session date"]);
  assert.ok(data.sectors.every((node) => Number.isFinite(node.flowCr) && node.volume > 0));
  const unavailable = buildMoneyRotation([]);
  assert.equal(unavailable.source, "unavailable");
  assert.equal(unavailable.netCr, null);
  assert.deepEqual(unavailable.links, []);
  assert.deepEqual(unavailable.sectors, []);
});

test("one-sided and unchanged markets never fabricate opposing flows", () => {
  for (const change of [1, -1, 0]) {
    const data = buildMoneyRotation(rotationQuotes().map((q) => ({ ...q, regularMarketChangePercent: change })));
    assert.equal(data.links.length, 0);
    assert.equal(data.matchedCr, 0);
    assert.equal(data.leaving.length, change < 0 ? 8 : 0);
    assert.equal(data.arriving.length, change > 0 ? 8 : 0);
    assert.equal(data.neutral.length, change === 0 ? 8 : 0);
    assert.ok(Number.isFinite(data.netCr));
  }
});

test("quote chunks cap requests at 40, pace 150ms, deduplicate, and survive failed chunks", async () => {
  const symbols = Array.from({ length: 95 }, (_, index) => `TEST${index}.NS`);
  const batches = [], waits = [];
  const result = await fetchQuoteChunks([...symbols, symbols[0]], async (chunk) => {
    batches.push(chunk);
    if (chunk[0] === "TEST40.NS") throw new Error("Simulated rate limit");
    return chunk.map((symbol) => ({ symbol }));
  }, async (ms) => { waits.push(ms); });
  assert.deepEqual(batches.map((batch) => batch.length), [40, 40, 15]);
  assert.deepEqual(waits, [150, 150]);
  assert.equal(result.quotes.length, 55);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0].symbols, symbols.slice(40, 80));
  assert.ok(result.quotes.some((quote) => quote.symbol === "TEST94.NS"));
});
