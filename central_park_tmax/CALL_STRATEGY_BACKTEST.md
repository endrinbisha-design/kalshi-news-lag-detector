# Backtest of trading rules on the logged days (2026-08-19 → 2026-10-25)

`scripts/call_strategy_backtest.py` → `backtest_datasets/call_strategy_backtest.json`.
Prices come from `track_record/kalshi_candles_pm.json`, written by
`scripts/archive_pm_candles.py` (Kalshi serves only ~two months of settled markets; the
archive now stops that history expiring — it holds 68 priced days, 08-19 onward).

**Question:** do the rules behind the daily 3:51 PM call — the banked max, the
rising/flat/falling shape, the preliminary CLI — beat the prices Kalshi was actually quoting
that afternoon, after fees?

**Answer: no.** No rule shows an after-fee edge, and the pool is a *worse* probability
estimate than the market on every metric.

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

## Results (θ = 0.10, flat $10 bets)

| rule | bets | hit rate | mean entry | net P&L | ROI on outlay | 95% interval on net |
|---|---|---|---|---|---|---|
| FAV — market's top bucket, 16:00 ask | 64 | 86 % | 87.1¢ | −$7.19 | −1.2 % | −$77 … +$53 |
| POOL_YES — pool beats ask by ≥10 pts | 34 | 15 % | 15.0¢ | −$86.41 | −25.6 % | −$317 … +$193 |
| POOL_NO — pool says market is rich by ≥10 pts | 44 | 23 % | 21.3¢ | −$42.63 | −9.8 % | −$307 … +$275 |
| PRELIM — bucket holding the preliminary, 17:00 ask | 37 | 95 % | 95.5¢ | −$4.06 | −1.1 % | −$37 … +$20 |
| …of which genuine 2-wide buckets | 24 | 96 % | 96.1¢ | −$0.11 | −0.05 % | −$23 … +$16 |
| …of which open-ended buckets | 13 | 92 % | 94.5¢ | −$3.95 | −3.2 % | −$27 … +$10 |
| DEAD_NO — NO on buckets ending below the banked max | 1 | 0 % | 32¢ | −$10.40 | −105 % | — |

FAV placed 64 bets on 68 days: on four days the favourite's ask was 100¢, so there was
nothing to buy.

**Probability quality** (408 bucket-outcomes, 16:00 candle):

| | Brier | log-loss |
|---|---|---|
| market (mid, normalised) | **0.037** | **0.123** |
| expanding pool | 0.057 | 0.230 |

## What each result means

* **The market is about fair.** Buying its favourite loses 1.2 % — essentially the fee
  (gross −$1.36 on $616 staked).
* **The pool adds nothing over the market.** It is worse on Brier and log-loss, so its
  disagreements are mostly the pool's error, and trading them loses (−26 % and −10 %). A
  shape-only pool ignores everything the market sees (sky, wind, the day's trajectory).
* **Higher thresholds look better, and should not be believed.** Sensitivity: YES at
  θ = 0.15 / 0.20 returned +3.7 % / +49.6 % (25 / 15 bets); NO at 0.15 / 0.20 returned
  +4.4 % / +23.0 % (30 / 18 bets). Every interval spans roughly ±$200. Eight variants were
  tried after seeing the headline; the best-looking ones are the smallest samples. This is
  not evidence of an edge.
* **The preliminary "lock" is priced fairly.** The earlier `SOURCE_RELIABILITY.md` figure of
  +0.9 % per bet was *before fees* and only on days when the preliminary and preliminary + 1
  sat in the same bucket (mean ask 99¢). Here the rule buys whichever bucket holds the
  preliminary, including the ones where the +1 spills into the next bucket, at a mean of
  95.5¢; the gross result is slightly negative and fees make it a wash.
* **The "dead bucket" is not arithmetic when a spike's QC is in doubt.** The one DEAD_NO bet
  is **08-27**: a rain-driven 80 °F ob at 15:51 sat above the settled 77, which NWS
  rejected as sensor contamination. The market priced that NO at 32¢ — it doubted the spike
  — and the bet lost its whole stake. `SOURCE_RELIABILITY.md` already records the day as the
  one failure of max-of-all-groups.

## Honest limits

* **68 priced days, one season** (late summer → fall); intervals are wide because of it.
* **Prices are candle closes** — no depth, no slippage, and a quiet candle's ask can be stale.
* The banked max comes from the IEM feed, which has **no SPECI** reports.
* Entry assumes a fill at the ask at the candle close; the 16:04 information cutoff in
  practice is tighter than the candle label suggests.
* The call's value so far is informational: the point estimate has hit exactly on most
  recent days. That is not the same as a tradeable edge, and this test finds none —
  consistent with `EDGE_DECAY.md`.

## Not tried

A pool conditioned on more than shape (wind, sky, dewpoint); a season-weighted pool; limit
orders inside the spread; the 15:00 candle (noisier — its +3 tail on 10-25 collapsed once the
15:51 ob arrived). The candle archive makes all of these runnable without waiting for new
days.
