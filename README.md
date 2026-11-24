# Market Pulse

App for showing India Stock Market pulse, trend, sentiments, money movements and more.

Dark-mode Indian market intelligence built with Next.js App Router, TypeScript,
Tailwind CSS, lightweight-charts, lucide-react, yahoo-finance2, and custom SVG.
Runs without credentials using process memory and browser-local persistence.
Optional Supabase Postgres makes snapshots and paper portfolios durable across
Vercel cold starts. There is no broker connection or real-money order execution.

## Run and verify

Use Node.js 22.18+ and npm:

```sh
npm install
npm run dev
```

Open http://localhost:3000. The dashboard renders immediately with N/A placeholders,
then restores saved observations while providers refresh. No synthetic prices
or candles are used. A first installation with no saved snapshot still needs
at least one successful upstream observation.

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
npm start
```

## Dashboard

- Ctrl+K / Cmd+K searches all configured stocks and three indices.
- Daily candlesticks and volume, 1M/3M/6M ranges, OHLC crosshair, pan and zoom.
- Market mood SVG dial and eight-sector money rotation sit side-by-side below
  the chart, with a full-width NSE F&O scanner below.
- Scanner: instant company/symbol search, sector dropdown, signal dropdown,
  gainers/losers/volume/signal quick filters, six sortable columns, day-range
  indicators, 25-row pagination, and click/keyboard chart selection.
- Star stocks to save a browser-local watchlist. No remote storage is used.
- Rotation clicks synchronize the scanner sector dropdown; clear the sector
  chip or reset all filters to restore coverage. Other filters are composable.
- Responsive layouts, keyboard focus support, and reduced-motion handling.
- Paper Algo navigation, six paused-by-default presets, configurable risk and
  symbol scope, manual paper LONG/SHORT fills, square-off, reset, ledger filters,
  CSV export, six-month backtests and SVG equity curves.
- Scanner rows open Paper Trade / Backtest for that stock. Open paper positions
  appear as Entry / Stop / Target horizontal lines on the symbol's chart.

## Universe and eligibility

`src/data/fnoStocks.ts` exports a typed 180+ stock universe including the requested
large-cap, Next-50-style, and liquid derivatives/midcap names across 14 sectors.
Coverage was compared on 2026-11-12 against the public
[NSE derivatives lot-size list](https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv),
[NIFTY 50 constituents](https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv),
and [NIFTY Next 50 constituents](https://www.niftyindices.com/IndexConstituent/ind_niftynext50list.csv),
including successor symbols absent from the original requested examples.
This is **configured coverage, not an exchange-certified current F&O list**.
NIFTY membership and F&O eligibility change. Validate current contracts with NSE
before trading. Renamed symbols were audited against the
[NSE symbol-change register](https://nsearchives.nseindia.com/content/equities/symbolchange.csv)
and Yahoo quotes on 2026-11-12. Retired aliases are removed rather than duplicated:
TATAMOTORS becomes TMPV, with TMCV also included (both Auto); ZOMATO becomes
ETERNAL; GMRINFRA becomes GMRAIRPORT; CENTURYTEX becomes ABREL; LTIM becomes LTM;
ICICIPRULI becomes ICICILIFE; MCDOWELL-N becomes UNITDSPR; INFIBEAM becomes
CCAVENUE. PEL is replaced by PIRAMALFIN following reorganization. PVRINOX is
still valid and retained. The corrected universe contains 266 unique stocks.
Command-palette items are derived from the same list. Unavailable tickers show
N/A, not invented market observations; retired query symbols return HTTP 400.

## Data API and cache

`GET /api/market-data?symbol=%5ENSEI` defaults to NIFTY 50. Any configured equity
or the three main indices can be selected. Invalid symbols return HTTP 400 and
the supported list.

All quotes, the rotation indices, and India VIX (`^INDIAVIX`) are fetched in
deduplicated batches of **at most 25 symbols**, with a **10-second batch deadline**
and **250-349ms jittered pacing**. Transient network, 429 and cookie/crumb failures
retry with exponential backoff, up to three attempts within the deadline.
Browser headers are set explicitly. A broken cookie handshake opens a
per-refresh circuit breaker rather than repeating it for every batch.

Missing equities try NSE's public F&O equity-index API after homepage cookie
warm-up. Yahoo chart metadata then recovers missing symbols using three paced
workers, six-second requests and a 110-second recovery budget. Daily volume
baselines use the preceding ten observed sessions, never invented averages.
NSE may block datacenter requests too; these public sources are not an SLA.
Failed or incomplete batches never discard other successes or erase saved prices.

The shared dataset uses a **30-minute process cache** backed by the latest
Supabase snapshot when configured. Concurrent refresh requests share one task.
The browser polls the cached API every 15 seconds to pick up completed background
refreshes without repeatedly fetching Yahoo. `?refresh=true` queues a shared
refresh while immediately returning existing observations. Background work uses
Next.js `after`, including on Vercel. Frequent refreshes can still cause throttling.

Six months of selected-symbol candles load lazily in the background and are
cached separately. `&history=true` waits for observed candles, as used by
backtesting. History failures preserve a previously observed series. A cached
snapshot is served without waiting for history or a market-wide refresh.
`X-Market-Cache` is `HIT` or `STALE`; HTTP caching is disabled.

`snapshotStatus` is `fresh`, `cached`, or `unavailable`. Quotes include their
provider `observedAt` timestamp and a `cached` flag. Saved quotes and observations
older than 30 minutes display **Cached / Last Session**; paper execution skips
them. Browser storage retains the most recent usable snapshot, including when
Supabase is absent. If no provider and no saved observation exist, N/A is honest
and unavoidable; prices are never fabricated to fill coverage.

Each quote exposes `price`, `changePercent`, `volume`, `avgVolume`,
`averageVolume` (compatibility alias), `volumeRatio`, `dayHigh`, `dayLow`,
`rangePosition`, `signal`, `source`, `missingFields`, and session `asOf`.
Volume baseline prefers Yahoo's 10-day average, otherwise the 3-month average.
Zero-volume sessions are valid; missing/invalid averages, volume ratios, signals,
and ranges are null rather than modeled. Flat observed day ranges use a neutral midpoint; out-of-range
prices clamp the marker to [0,1].

Source is `yahoo`, `nse`, `mixed`, or `unavailable`, with separate `candleSource`, mood/rotation
sources, and an API coverage summary. Missing fields are logged, included in
warning/provenance metadata, and rendered as N/A in the UI. Missing prices null
all dependent observations; partial quotes retain valid observed fields.
Unavailable rows sort last and do not match numeric/signal quick filters.
History failures return an empty candle array with an explicit unavailable
placeholder, not generated candles. Fetched time is not session time.

## Optional Supabase and scheduled sync

1. Run [001_paper_algo.sql](supabase/migrations/001_paper_algo.sql) in your
   Supabase SQL editor. It creates snapshots, portfolios, strategies, positions,
   orders, RLS restrictions and transactional save/load functions.
2. Set these environment variables locally in git-ignored `.env.local` and in
   your Vercel project:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_PUBLISHABLE_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
   CRON_SECRET=YOUR_RANDOM_CRON_SECRET
   ```

   Never prefix the service-role key with `NEXT_PUBLIC_`, put it in browser
   code, or commit it. The publishable key alone does **not** enable writes:
   private tables and RPCs are deliberately inaccessible to browser roles.
3. With URL + service-role key configured, snapshots persist automatically and
   portfolios use `/api/paper`. Without both, the app uses memory and localStorage.
   Cloud failures are logged and surfaced, not silently reported as successful.
4. [vercel.json](vercel.json) schedules `/api/cron/sync-market` at
   03:45, then every 15 minutes from 04:00 through 10:00 UTC, Monday-Friday.
   It requires `Authorization: Bearer <CRON_SECRET>` and refuses requests when
   the secret is unset. Exchange holidays are not inferred.
   **Vercel Hobby does not support 15-minute cron frequency**; use a compatible
   Vercel plan or an external scheduler calling the same secured endpoint.
   Supabase's free tier can still provide the database.

Anonymous cloud portfolios are isolated by a random browser UUID stored in an
HttpOnly, SameSite=Strict cookie. Writes check origin and use atomic revision
compare-and-swap to reject conflicting tabs. This is not account authentication
or cross-device sync; clearing the cookie creates a new identity. Local and
cloud portfolios are separate; switching modes does not overwrite or import a
local portfolio implicitly. Browser backups remain private to that browser.
No Upstash account is required; the fallback is memory plus localStorage.

## Paper execution and historical simulation

Default virtual capital is INR 10,00,000; reset can choose INR 1,000 through
1 billion. All presets start paused. Every strategy has an allocation cap
across its positions, SL, target and optional trailing stop. EMA, RSI and
squeeze presets initially scan RELIANCE; choose another symbol in Customize.
Other presets scan observed stocks. OI is the existing simulated price/volume
signal, not exchange open interest. Financials maps to Banking, Capital Goods /
Realty / Telecom to Infra, and Consumer to FMCG for rotation rules.

Risk exits run even when entries are paused. New source timestamps deduplicate
fills, including delayed feeds; cached, null, undated and unavailable quotes
cannot execute. Sector baskets hold at most two names, each capped at half the
strategy allocation, and exit when the held sector's flow becomes negative.

Fills apply 0.05% adverse slippage and INR 20 brokerage per order. The educational
delivery-style cost estimate includes 0.1% STT each side, 0.00322% exchange/SEBI,
18% GST on brokerage/exchange costs, and 0.015% buy-side stamp duty. This is not
a broker tax statement. Shorts reserve 100% entry notional: sale proceeds cannot
fund additional positions. Overnight cash-equity short eligibility is not
simulated. Realized P&L deducts both entry and exit fees; unrealized P&L is gross.

The evaluator runs while the browser is open, on fresh observed snapshots; the
cron refreshes market data, **not unattended strategy execution**. Delayed public
quotes cannot provide exchange-level stop guarantees or intraday ORB precision.
The ORB preset is explicitly a daily-range momentum proxy.

Backtests use completed daily signals, next-session open fills, stop-first
handling when both SL and target occur in a bar, adverse gap fills, identical
friction, trailing stops activated for the next bar, and terminal liquidation.
Macro presets obtain real six-month market-wide histories through
`/api/algo/backtest-data`: daily observed breadth/NIFTY/VIX for mood and actual
sector-index returns for rotation. This on-demand operation shares three
paced workers and a two-minute universe budget, rather than loading hundreds
of histories on normal dashboard visits. Partial historical coverage is
disclosed, and unknown required context skips entries. No current market mood
is projected into the past.

Sector backtests evaluate both historical leaders as one portfolio, not two
independently funded accounts. Missing terminal bars retain last-observed marks
without inventing a liquidation fill. EMA/RSI and volume baselines have warm-up
periods within the six-month window. Results include net P&L, closed-trade win
rate, peak-to-trough drawdown, profit factor, closed trades and daily equity.
Profit factor is displayed as "No losing trades" when gains exist without losses.
Daily-bar results cannot reproduce intraday execution and include survivorship
bias from today's configured universe.

Tests use Node's canonical runner. Test-only deterministic price fixtures never
enter live code. Embedded Postgres (PGlite) executes the actual migration and
checks transactional rollback, round-trip parity and publishable-role denial;
it does not replace verifying a deployment's Supabase credentials/PostgREST.

## Market mood methodology

The rounded 0-100 score is a transparent model, not an official sentiment index:

- Breadth (45%): `(advances + 0.5 * unchanged) / sample size * 100`.
  Quotes without observed price and change are always excluded.
- NIFTY (30%): `clamp(50 + dailyChangePercent / 3 * 50, 0, 100)`,
  mapping -3% to 0, flat to 50, and +3% to 100.
- Inverse India VIX (25%): `clamp((35 - VIX) / 25 * 100, 0, 100)`,
  mapping VIX 10 to 100 and VIX 35 to 0. Missing VIX displays N/A.
  The overall score is N/A if breadth, NIFTY change, or VIX is unavailable.

Regimes: 0-25 Extreme Fear / Risk-off; 26-44 Cautious / Risk-off; 45-55 Neutral;
56-74 Constructive / Risk-on; 75-100 Euphoria / Strong Risk-on.

High-volume breakouts count positive-change stocks with volume ratio **>2**
and day range position **>=0.8**, using observed fields only.
This is a screening proxy, not a confirmed technical breakout. Missing volume
or range fields are excluded; no eligible observations yields an N/A count.

## Rotation, breadth, and simulated OI

Rotation indices: `^NSEBANK`, `^CNXIT`, `^CNXAUTO`, `^CNXENERGY`, `^CNXFMCG`,
`^CNXPHARMA`, `^CNXMETAL`, and `^CNXINFRA`.
Score = daily change / 100 * relative index volume. Estimated rupees multiply
that score by an **assumed INR 100,000 crore notional**. These are **not actual
capital transfers or traded rupees**. Ribbons proportionally pair only the
smaller total inflow/outflow; one-sided or unchanged markets fabricate no links.
Yahoo often omits index volume or returns zero: labeled illustrative weights
preserve real daily changes where available. Tooltips show exact inputs.
Missing sector changes are excluded and listed as N/A, never synthesized.

Breadth and equal-weight sector return cards cover the configured universe,
excluding quotes without observed price/change. Sectors without observations
display N/A, not a zero return. Neither represents the entire NSE.

Simulated signals use positive change and ratio >=1 for Long Buildup; positive
and <1 for Short Covering; negative and >=1 for Short Buildup; negative and <1
for Long Unwinding. Zero change or an observed zero volume ratio is Neutral;
missing/invalid signal inputs produce N/A.
No actual derivatives open-interest data is fetched.

All market data is delayed/end-of-day from public sources, not a live feed.
This is educational, not investment advice. Check Yahoo's data terms before
redistribution or commercial use.
