"""Archive the KXHIGHNY afternoon candles (14:00-17:00 EDT) for every logged day.

Kalshi serves only ~two months of settled markets, so the prices behind any backtest of
the 3:51 PM call expire day by day unless they are written down. This script stores, per
day and per strike bucket, the bid/ask close of the hourly candles ending 18:00, 19:00,
20:00 and 21:00 UTC (14:00, 15:00, 16:00, 17:00 EDT) in
``track_record/kalshi_candles_pm.json``.

The cache only ever ADDS days (a day already stored is skipped), so history stops
expiring. A day Kalshi no longer serves is recorded as ``null`` so it is not retried.

Usage (from central_park_tmax/):
    python3 scripts/archive_pm_candles.py [YYYY-MM-DD ...]   # default: every logged day
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from source_reliability import _SUB, _candle_cents  # noqa: E402

UA = {"User-Agent": "central_park_tmax/0.1 (research)"}
B = "https://api.elections.kalshi.com/trade-api/v2"
OUT = ROOT / "track_record" / "kalshi_candles_pm.json"
HOURS = (18, 19, 20, 21)          # candle END hour, UTC


def _get(url: str):
    last = None
    for delay in (0, 2, 4, 8, 16, 30):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                return None
            if exc.code != 429 and exc.code < 500:
                raise
        except Exception as exc:                  # noqa: BLE001 - transport failure retries
            last = exc
    raise RuntimeError(f"Kalshi fetch failed after retries: {last}")


def _bucket(label: str):
    sub = label.replace("°", "").strip()
    for pat, fn in _SUB:
        m = re.match(pat, sub, re.I)
        if m:
            return fn(m)
    return None


def fetch_day(day: dt.date):
    ticker = f"KXHIGHNY-{day:%y%b%d}".upper()
    ev = _get(f"{B}/events/{ticker}?with_nested_markets=true")
    markets = (ev or {}).get("event", {}).get("markets", [])
    if not markets:
        return None
    end21 = int(dt.datetime(day.year, day.month, day.day, 21, tzinfo=dt.timezone.utc).timestamp())
    out = []
    for m in markets:
        bk = _bucket(m.get("yes_sub_title") or m.get("subtitle") or "")
        if bk is None:
            continue
        time.sleep(2.0)
        cs = (_get(f"{B}/series/KXHIGHNY/markets/{m['ticker']}/candlesticks"
                   f"?start_ts={end21 - 5 * 3600}&end_ts={end21}&period_interval=60") or {}
              ).get("candlesticks", [])
        px = {}
        for c in cs:
            h = dt.datetime.fromtimestamp(c.get("end_period_ts", 0), dt.timezone.utc).hour
            if h in HOURS:
                px[str(h)] = [_candle_cents(c.get("yes_bid"), "close"),
                              _candle_cents(c.get("yes_ask"), "close")]
        out.append({"lo": bk[0], "hi": bk[1], "px": px})
    return sorted(out, key=lambda r: r["lo"])


def main(argv):
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    if argv:
        days = [dt.date.fromisoformat(a) for a in argv]
    else:
        log = [json.loads(l) for l in (ROOT / "track_record" / "call_log.jsonl").open()]
        days = sorted({dt.date.fromisoformat(r["target_date"]) for r in log})
    for d in days:
        key = d.isoformat()
        if key in cache:
            continue
        for pause in (0, 60, 180, 300):
            time.sleep(pause)
            try:
                cache[key] = fetch_day(d)
                break
            except RuntimeError as exc:           # sustained 429s: wait it out, keep progress
                print(key, "retrying after", exc, flush=True)
        else:
            print(key, "skipped for now; re-run to resume", flush=True)
            continue
        OUT.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n")
        print(key, "n/a" if cache[key] is None else f"{len(cache[key])} buckets", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
