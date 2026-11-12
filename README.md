# Market Pulse

Dark-mode Indian market intelligence built with Next.js App Router, TypeScript,
Tailwind CSS, lightweight-charts, lucide-react, yahoo-finance2, and custom SVG.
No API keys, paid services, databases, or accounts.

## Run and verify

Use Node.js 22.18+ and npm:

```sh
npm install
npm run dev
```

Open http://localhost:3000. The dashboard renders immediately with N/A placeholders,
then shows observed delayed data when Yahoo responds. No synthetic prices are used.

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
deduplicated batches of **at most 40 symbols**. Each batch uses
`Promise.allSettled`; batches are sequential with **150ms** between them.
Failed chunks do not discard successful ones. Network requests time out after
6 seconds. Pacing reduces pressure but **cannot guarantee no Yahoo rate limits**.

The shared dataset and symbol responses use a **30-minute in-memory cache**.
Concurrent initial/refresh requests share the snapshot fetch. The browser
rechecks every 30 minutes. `?refresh=true` and the Refresh button bypass the
snapshot and selected history caches; refreshing invalidates old symbol
responses. Frequent manual refreshes may cause Yahoo throttling.

Six months of selected-symbol candles are fetched lazily and cached separately,
rather than requesting hundreds of histories on every initial load. First loads
and first uncached chart selections depend on Yahoo latency. Warm response hits
avoid Yahoo completely; a universal <50ms end-to-end guarantee is not possible
across cold starts, network latency, and payload transfer. `X-Market-Cache` is
`HIT`, `MISS`, or `REFRESH`; HTTP caching is disabled so bypasses reach the route.
Caches are per process and reset on restarts or serverless cold starts.

Each quote exposes `price`, `changePercent`, `volume`, `avgVolume`,
`averageVolume` (compatibility alias), `volumeRatio`, `dayHigh`, `dayLow`,
`rangePosition`, `signal`, `source`, `missingFields`, and session `asOf`.
Volume baseline prefers Yahoo's 10-day average, otherwise the 3-month average.
Zero-volume sessions are valid; missing/invalid averages, volume ratios, signals,
and ranges are null rather than modeled. Flat observed day ranges use a neutral midpoint; out-of-range
prices clamp the marker to [0,1].

Source is `yahoo`, `mixed`, or `unavailable`, with separate `candleSource`, mood/rotation
sources, and an API coverage summary. Missing fields are logged, included in
warning/provenance metadata, and rendered as N/A in the UI. Missing prices null
all dependent observations; partial quotes retain valid observed fields.
Unavailable rows sort last and do not match numeric/signal quick filters.
History failures return an empty candle array with an explicit unavailable
placeholder, not generated candles. Fetched time is not session time.

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
