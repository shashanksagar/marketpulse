import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createPortfolio, openPosition } from "../src/lib/algo/engine.ts";
import { createInitialData, INSTRUMENTS, normalizeQuote } from "../src/lib/market.ts";
import { isAlgoState } from "../src/lib/algo/storage.ts";

let db;
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const migration = await readFile(new URL("../supabase/migrations/001_paper_algo.sql", import.meta.url), "utf8");
  await db.exec(migration);
});
after(async () => { await db?.close(); });

async function save(state, revision) {
  const result = await db.query("select save_paper_state($1::uuid,$2::integer,$3::jsonb) revision", [state.portfolio.user_key, revision, JSON.stringify(state)]);
  return result.rows[0].revision;
}
async function load(key) {
  return (await db.query("select load_paper_state($1::uuid) state", [key])).rows[0].state;
}

test("Postgres migration saves and reloads a complete independent portfolio, settings, positions and ledger", async () => {
  const state = createPortfolio();
  const q = normalizeQuote(INSTRUMENTS[3], { symbol: INSTRUMENTS[3].symbol, regularMarketPrice: 100, regularMarketTime: new Date("2026-11-24T05:00:00Z") });
  openPosition(state, state.strategies[0], q, "LONG", 100000, "2026-11-24T05:00:00Z");
  assert.equal(await save(state, -1), 0);
  const restored = await load(state.portfolio.user_key);
  assert.equal(isAlgoState(restored), true);
  assert.equal(restored.portfolio.cash_balance, state.portfolio.cash_balance);
  assert.equal(restored.positions[0].qty, state.positions[0].qty);
  assert.equal(restored.orders[0].fees, state.orders[0].fees);
  assert.equal(restored.strategies.length, 6);
  const second = createPortfolio(500000);
  await save(second, -1);
  assert.equal((await load(second.portfolio.user_key)).orders.length, 0);
  assert.equal((await load(state.portfolio.user_key)).orders.length, 1);
});

test("Postgres compare-and-swap rejects stale revisions and rolls back an invalid replacement atomically", async () => {
  const state = createPortfolio();
  await save(state, -1);
  assert.equal(await save(state, 0), 1);
  await assert.rejects(save(state, 0), /conflict/);
  const invalid = structuredClone(state);
  invalid.strategies[0].capital_allocation_pct = -1;
  await assert.rejects(save(invalid, 1), /check constraint/);
  const restored = await load(state.portfolio.user_key);
  assert.equal(restored.revision, 1);
  assert.equal(restored.strategies.length, 6);
  assert.equal(restored.strategies[0].capital_allocation_pct, 15);
});

test("snapshot RPC keeps the latest valid observations and rejects empty outages", async () => {
  const data = createInitialData();
  data.stocks[0] = normalizeQuote(INSTRUMENTS[3], { symbol: INSTRUMENTS[3].symbol, regularMarketPrice: 100, regularMarketTime: new Date() });
  await db.query("select save_market_snapshot($1::jsonb)", [JSON.stringify(data)]);
  const stale = { ...data, fetchedAt: "2020-01-01T00:00:00Z" };
  await db.query("select save_market_snapshot($1::jsonb)", [JSON.stringify(stale)]);
  await assert.rejects(db.query("select save_market_snapshot($1::jsonb)", [JSON.stringify(createInitialData())]), /no observed prices/);
  const saved = await db.query("select payload from market_snapshots where id='nse-latest'");
  assert.equal(saved.rows[0].payload.fetchedAt, data.fetchedAt);
  assert.equal(saved.rows[0].payload.stocks[0].price, 100);
});

test("publishable-key roles cannot access private tables or service-role RPCs", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select * from paper_portfolios"), /permission denied/);
    await assert.rejects(db.query("select load_paper_state($1::uuid)", [crypto.randomUUID()]), /permission denied/);
    await assert.rejects(db.query("select save_market_snapshot('{}'::jsonb)"), /permission denied/);
  } finally { await db.exec("reset role"); }
});
