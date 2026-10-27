"""Backtest trading rules on the logged days, at the prices actually quoted that afternoon.

Everything here is decided from information available at the 16:00 EDT candle (banked max
through the 15:51 ob, the 14:51 -> 15:51 shape, the 8 AM-2 PM group) plus the 16:33 PM
preliminary CLI for the one rule that uses it. Settlement is the logged final CLI high.

Strategies (fixed BEFORE looking at any result; thresholds were not tuned on this sample):

  FAV      buy YES on the bucket with the highest 16:00 ask               (market baseline)
  POOL_YES buy YES wherever pool_p - ask >= THETA                          (pool says cheap)
  POOL_NO  buy NO  wherever (1 - pool_p) - no_ask >= THETA                 (pool says rich)
  PRELIM   buy YES on the bucket holding the preliminary high, 17:00 ask   (the "lock"),
           also reported split into genuine 2-wide and open-ended buckets
  DEAD_NO  buy NO on buckets that end below the banked max, 16:00          (arithmetic check)

``pool_p`` is an EXPANDING-window pool: for day d it uses only days strictly before d, the
distribution of (settled high - banked max at 15:51) split by shape (rising / flat /
falling), falling back to the all-shape pool until a shape has MIN_SHAPE samples. Every bet
is a flat $10 at the ask; fees follow Kalshi's schedule (7% x C x p x (1-p), rounded up).

Honest limits, repeated in the report: ~60 priced days, one season, prices are candle
closes (no depth), SPECI reports are not in the IEM feed used for the banked max, and the
strategies' bets within a day are correlated, so intervals resample DAYS, not bets.

Usage (from central_park_tmax/):  python3 scripts/call_strategy_backtest.py
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from source_reliability import half_up, load_metar  # noqa: E402

STAKE = 10.0
THETA = 0.10
MIN_SHAPE = 8
SMOOTH = 0.5          # pseudo-count on remaining-rise 0..3
H_ENTRY, H_LOCK = "20", "21"          # candle END hour UTC: 16:00 and 17:00 EDT
OUT = ROOT / "backtest_datasets" / "call_strategy_backtest.json"


def fee(contracts: float, p: float) -> float:
    return math.ceil(0.07 * contracts * p * (1 - p) * 100 - 1e-9) / 100


def settle_bet(side: str, price_c: float, hit_yes: bool):
    """(net_profit_after_fee, gross_profit, outlay) for a flat-$ order at ``price_c`` cents."""
    p = price_c / 100.0
    if p <= 0 or p >= 1:
        return None
    c = math.floor(STAKE / p)
    if c < 1:
        return None
    win = hit_yes if side == "yes" else (not hit_yes)
    gross = c * (1 - p) if win else -c * p
    return gross - fee(c, p), gross, c * p


def features(d, snap, grp):
    sn, g = snap.get(d, {}), grp.get(d, {})
    keys = sorted(k for k in sn if "01:51" <= k <= "15:51")
    if "15:51" not in sn or "14:51" not in sn or "08" not in g:
        return None
    hourly = [half_up(sn[k]) for k in keys]
    banked = max(hourly + [half_up(g[k]) for k in ("02", "08") if k in g])
    a, b = half_up(sn["15:51"]), half_up(sn["14:51"])
    shape = "rising" if a > b else "falling" if a < b else "flat"
    return {"banked": banked, "shape": shape, "h1551": a}


def pool_pmf(history, shape):
    rows = [r for r in history if r["shape"] == shape]
    if len(rows) < MIN_SHAPE:
        rows = history
    cnt = collections.Counter(r["rise"] for r in rows)
    for k in range(4):
        cnt[k] += SMOOTH
    tot = sum(cnt.values())
    return {k: v / tot for k, v in cnt.items()}, len(rows)


def pool_prob(pmf, banked, lo, hi):
    return sum(p for r, p in pmf.items() if lo <= banked + r <= hi)


def summarize(bets, days_all):
    """Totals and a day-resampled 95% interval on net P&L."""
    if not bets:
        return {"n": 0}
    by_day = collections.defaultdict(float)
    for b in bets:
        by_day[b["day"]] += b["net"]
    net = sum(b["net"] for b in bets)
    staked = sum(b["staked"] for b in bets)
    rng = random.Random(7)
    ds = sorted(days_all)
    boots = sorted(sum(by_day.get(rng.choice(ds), 0.0) for _ in ds) for _ in range(4000))
    return {"n": len(bets), "days": len(by_day), "hit": sum(b["win"] for b in bets) / len(bets),
            "mean_entry_c": sum(b["price"] for b in bets) / len(bets),
            "net": round(net, 2), "gross": round(sum(b["gross"] for b in bets), 2),
            "staked": round(staked, 2), "roi_pct": round(100 * net / staked, 2),
            "net_ci95": [round(boots[100], 2), round(boots[3899], 2)]}


def main():
    log = {r["target_date"]: r for r in map(json.loads, (ROOT / "track_record/call_log.jsonl").open())}
    cache = json.loads((ROOT / "track_record/kalshi_candles_pm.json").read_text())
    first = min(log)
    snap, grp = load_metar(dt.date.fromisoformat(first), dt.date.today() + dt.timedelta(days=1))

    history, rows = [], []
    for ds in sorted(log):
        d = dt.date.fromisoformat(ds)
        f = features(d, snap, grp)
        if f is None:
            continue
        H = log[ds]["actual_high_f"]
        buckets = cache.get(ds)
        row = {"day": ds, **f, "H": H, "rise": H - f["banked"], "prelim": log[ds].get("prelim_high_f")}
        if buckets:
            pmf, npool = pool_pmf(history, f["shape"])
            row.update(npool=npool, pmf=pmf, buckets=buckets)
            rows.append(row)
        history.append(row)

    # drop the first days, where even the all-shape pool is thin
    priced = [r for r in rows if sum(1 for h in history if h["day"] < r["day"]) >= 20]
    days_all = [r["day"] for r in priced]

    bets = collections.defaultdict(list)

    def add(name, r, b, side, price_c, hit_yes):
        s = settle_bet(side, price_c, hit_yes)
        if s is None:
            return
        win = hit_yes if side == "yes" else (not hit_yes)
        bets[name].append({"day": r["day"], "lo": b["lo"], "hi": b["hi"], "side": side, "price": price_c,
                           "win": win, "net": s[0], "gross": s[1], "staked": s[2]})

    brier_pool = brier_mkt = ll_pool = ll_mkt = nb = 0.0
    for r in priced:
        hit = lambda b: b["lo"] <= r["H"] <= b["hi"]
        assert sum(hit(b) for b in r["buckets"]) == 1, r["day"]
        quotes = [(b, b["px"].get(H_ENTRY)) for b in r["buckets"]]
        quotes = [(b, q) for b, q in quotes if q and q[0] is not None and q[1] is not None]
        if len(quotes) < len(r["buckets"]):
            continue
        # market baseline
        fav = max(quotes, key=lambda bq: bq[1][1])
        add("FAV", r, fav[0], "yes", fav[1][1], hit(fav[0]))
        mids = {id(b): (q[0] + q[1]) / 200 for b, q in quotes}
        z = sum(mids.values())
        for b, q in quotes:
            pp = pool_prob(r["pmf"], r["banked"], b["lo"], b["hi"])
            y = 1.0 if hit(b) else 0.0
            pm = mids[id(b)] / z
            brier_pool += (pp - y) ** 2
            brier_mkt += (pm - y) ** 2
            ll_pool += -math.log(max(1e-4, pp if y else 1 - pp))
            ll_mkt += -math.log(max(1e-4, pm if y else 1 - pm))
            nb += 1
            yes_ask, no_ask = q[1], 100 - q[0]
            if pp - yes_ask / 100 >= THETA:
                add("POOL_YES", r, b, "yes", yes_ask, hit(b))
            if (1 - pp) - no_ask / 100 >= THETA:
                add("POOL_NO", r, b, "no", no_ask, hit(b))
            if b["hi"] < r["banked"]:
                add("DEAD_NO", r, b, "no", no_ask, hit(b))
        if r["prelim"] is not None:
            for b in r["buckets"]:
                q = b["px"].get(H_LOCK)
                if b["lo"] <= r["prelim"] <= b["hi"] and q and q[1] is not None:
                    add("PRELIM", r, b, "yes", q[1], hit(b))
                    add("PRELIM_2W" if b["hi"] - b["lo"] == 1 else "PRELIM_OPEN",
                        r, b, "yes", q[1], hit(b))

    res = {name: summarize(bs, days_all) for name, bs in bets.items()}
    # threshold sensitivity for the pool rules (reported, NOT used for the headline)
    sens = {}
    for th in (0.05, 0.10, 0.15, 0.20):
        for side in ("yes", "no"):
            sb = []
            for r in priced:
                for b in r["buckets"]:
                    q = b["px"].get(H_ENTRY)
                    if not q or q[0] is None or q[1] is None:
                        continue
                    pp = pool_prob(r["pmf"], r["banked"], b["lo"], b["hi"])
                    h = b["lo"] <= r["H"] <= b["hi"]
                    edge = (pp - q[1] / 100) if side == "yes" else ((1 - pp) - (100 - q[0]) / 100)
                    if edge >= th:
                        s = settle_bet(side, q[1] if side == "yes" else 100 - q[0], h)
                        if s:
                            sb.append({"day": r["day"], "net": s[0], "gross": s[1], "staked": s[2],
                                       "win": h if side == "yes" else not h,
                                       "price": q[1] if side == "yes" else 100 - q[0]})
            sens[f"{side}@{th:.2f}"] = summarize(sb, days_all)

    out = {"priced_days": len(priced), "first": days_all[0] if days_all else None,
           "last": days_all[-1] if days_all else None, "theta": THETA, "stake": STAKE,
           "results": res, "sensitivity": sens,
           "calibration": {"bucket_obs": int(nb), "brier_pool": brier_pool / max(nb, 1),
                           "brier_market": brier_mkt / max(nb, 1),
                           "logloss_pool": ll_pool / max(nb, 1), "logloss_market": ll_mkt / max(nb, 1)}}
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"priced days: {len(priced)}  ({out['first']} .. {out['last']})")
    for name in ("FAV", "POOL_YES", "POOL_NO", "PRELIM", "PRELIM_2W", "PRELIM_OPEN", "DEAD_NO"):
        print(f"{name:9s}", json.dumps(res.get(name, {"n": 0})))
    print("calibration", json.dumps(out["calibration"]))
    print("sensitivity")
    for k, v in sens.items():
        print(f"  {k:9s} n={v.get('n', 0):3d}  roi={v.get('roi_pct')}  net={v.get('net')}  ci={v.get('net_ci95')}")


if __name__ == "__main__":
    main()
