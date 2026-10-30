# Backtest of trading rules on the logged days (2026-08-19 → 2026-10-28)

`scripts/call_strategy_backtest.py` → `backtest_datasets/call_strategy_backtest.json`
(`--window N` writes `call_strategy_backtest_wN.json`).
Prices come from `track_record/kalshi_candles_pm.json`, written by
`scripts/archive_pm_candles.py` (Kalshi serves only ~two months of settled markets; the
archive stops that history expiring — it holds 71 priced days, 08-19 onward).

**Question:** do the rules behind the daily 3:51 PM call — the banked max, the
rising/flat/falling shape, the preliminary CLI — beat the prices Kalshi was actually quoting
that afternoon, after fees?

**Answer: no.** No rule shows an after-fee edge, and the pool is a *worse* probability
estimate than the market on every metric. First run was on 68 days; this version is
re-run on 71 (three more days), and the one place the story moved is flagged below.

## Setup

* **Decision time:** the 16:00 EDT candle (the PRELIM rule uses the 17:00 candle, after the
  ~4:33 PM preliminary). Entry at the quoted **ask**; NO at `100 − yes_bid`.
* **Settlement:** the logged final CLI high. Flat **$10** per bet (`floor(10/p)` contracts),
  Kalshi fee `ceil(7% × C × p × (1−p))`.
* **Pool:** expanding window — day *d* uses only days before *d*: the distribution of
  (settled high − banked max at 15:51) by shape, falling back to all shapes until a shape
  has 8 samples; 0.5 pseudo-count on remaining rises 0–3. At least 20 prior days required.
* **Fixed before looking:** edge threshold θ = 0.10 for the two pool rules. Other θ values
  are reported below as sensitivity only.
* **Intervals:** 95% bootstrap over **days** (bets within a day are correlated).

## Results (θ = 0.10, flat $10 bets, 71 priced days)

| rule | bets | hit rate | mean entry | net P&L | ROI on outlay | 95% interval on net |
|---|---|---|---|---|---|---|
| FAV — market's top bucket, 16:00 ask | 67 | 87 % | 87.0¢ | −$1.27 | −0.2 % | −$73 … +$60 |
| POOL_YES — pool beats ask by ≥10 pts | 36 | 14 % | 15.3¢ | −$107.27 | −30.1 % | −$334 … +$182 |
| POOL_NO — pool says market is rich by ≥10 pts | 46 | 22 % | 21.3¢ | −$63.47 | −13.9 % | −$326 … +$256 |
| PRELIM — bucket holding the preliminary, 17:00 ask | 39 | 95 % | 95.6¢ | −$3.60 | −0.95 % | −$36 … +$21 |
| …of which genuine 2-wide buckets | 26 | 96 % | 96.2¢ | +$0.35 | +0.14 % | −$23 … +$17 |
| …of which open-ended buckets | 13 | 92 % | 94.5¢ | −$3.95 | −3.2 % | −$27 … +$10 |
| DEAD_NO — NO on buckets ending below the banked max | 1 | 0 % | 32¢ | −$10.40 | −105 % | — |

FAV placed 67 bets on 71 days: on four days the favourite's ask was 100¢, so there was
nothing to buy.

**Probability quality** (426 bucket-outcomes, 16:00 candle):

| | Brier | log-loss |
|---|---|---|
| market (mid, normalised) | **0.036** | **0.121** |
| expanding pool | 0.057 | 0.227 |

## What each result means

* **The market is about fair.** Buying its favourite is a wash: gross +$4.89 on $645 staked,
  −$1.27 after fees.
* **The pool adds nothing over the market.** It is worse on Brier and log-loss, so its
  disagreements are mostly the pool's error, and trading them loses (−30 % and −14 %). A
  shape-only pool ignores everything the market sees (sky, wind, the day's trajectory).
* **Higher thresholds look better, and should not be believed.** At θ = 0.20 the pool rules
  returned +40 % (YES, 16 bets) and +16 % (NO, 19 bets), every interval spanning roughly
  ±$150–330. The warning is in how they moved: at θ = 0.15 the same rules were **+3.7 % /
  +4.4 %** on 68 days and are **−0.5 % / +0.9 %** on 71. Three more days erased it. Eight
  variants were tried after seeing the headline; the best-looking ones are the smallest
  samples. This is not evidence of an edge.
* **The preliminary "lock" is priced fairly.** The earlier `SOURCE_RELIABILITY.md` figure of
  +0.9 % per bet was *before fees* and only on days when the preliminary and preliminary + 1
  sat in the same bucket (mean ask 99¢). Here the rule buys whichever bucket holds the
  preliminary, including the ones where the +1 spills into the next bucket, at a mean of
  95.6¢; the gross result is slightly negative and fees make it a wash.
* **The "dead bucket" is not arithmetic when a spike's QC is in doubt.** The one DEAD_NO bet
  is **08-27**: a rain-driven 80 °F ob at 15:51 sat above the settled 77, which NWS
  rejected as sensor contamination. The market priced that NO at 32¢ — it doubted the spike
  — and the bet lost its whole stake. `SOURCE_RELIABILITY.md` already records the day as an
  exception to max-of-all-groups.

## Would a rolling window fix the pool? No — tested 2026-10-30

The pool is an expanding window built mostly from August and September, and since 10-24 the
afternoon gain has been smaller than it predicts (+0, +1, +1, +0, +0 on the non-artifact
days). Seasonal drift — shorter days, lower sun — is the natural explanation, which suggests
a rolling window. The run says otherwise:

| pool | Brier | log-loss | POOL_YES ROI | POOL_NO ROI |
|---|---|---|---|---|
| expanding (headline) | **0.0566** | **0.227** | −30 % | −14 % |
| last 30 days | 0.0603 | 0.231 | −14 % | −18 % |
| last 21 days | 0.0638 | 0.238 | −22 % | −12 % |
| last 14 days | 0.0633 | 0.237 | −40 % | −17 % |
| *market* | *0.0364* | *0.121* | — | — |

Shorter windows are **worse**, not better: each throws away data faster than it gains
season-relevance, and every pool stays far from the market's 0.036. The drift may be real but
a shape-only pool, windowed or not, cannot see it well enough to matter; do not switch the
daily call's pool to a rolling window on this evidence.

## Honest limits

* **71 priced days, one season** (late summer → fall); intervals are wide because of it.
* **Prices are candle closes** — no depth, no slippage, and a quiet candle's ask can be stale.
* The banked max comes from the IEM feed, which has **no SPECI** reports.
* Entry assumes a fill at the ask at the candle close; the 16:04 information cutoff in
  practice is tighter than the candle label suggests.
* The call's value so far is informational: the point estimate has hit exactly on most
  recent days. That is not the same as a tradeable edge, and this test finds none —
  consistent with `EDGE_DECAY.md`.

## Not tried

A pool conditioned on more than shape (wind, sky, dewpoint); a month-restricted pool;
limit orders inside the spread; the 15:00 candle (noisier — its +3 tail on 10-25 and its
stale pre-15:51 prices on 10-29 show why). The candle archive makes all of these runnable
without waiting for new days.
