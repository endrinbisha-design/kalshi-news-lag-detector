#!/usr/bin/env python3
"""
Kalshi News-Lag Detector — one-off runner.

Pipeline:
  1. Pull open Kalshi markets (optionally filtered by category / close time).
  2. Build a keyword/entity profile for each market.
  3. Query NewsAPI per market and keep articles with enough keyword overlap.
  4. Score matched markets with Claude (relevance + implied fair probability).
  5. Flag markets where |fair_price - market_price| exceeds the gap threshold.
  6. Log flags to SQLite and print a summary table.

This is a manual, one-shot script (not a daemon) so you can validate the logic.
It executes NO trades — detection and logging only.

Usage:
    python main.py                      # full run using config.yaml/.env
    python main.py --category Politics  # override categories
    python main.py --threshold 8        # override gap threshold (pp)
    python main.py --limit 25           # cap markets scanned
    python main.py --dry-run            # skip the LLM; just show matches
    python main.py --max-llm-calls 20   # cap paid LLM calls per run
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from config import load_config
from kalshi_client import KalshiClient
from llm_scorer import LLMScorer, Verdict
from market_profiler import MarketProfile, build_profile, count_keyword_hits
from news_client import NewsClient, normalize_article
from storage import Opportunity, Storage

try:
    from rich.console import Console
    from rich.table import Table

    _RICH = True
    _console = Console()
except ImportError:  # pragma: no cover
    _RICH = False
    _console = None


def log(msg: str) -> None:
    if _RICH:
        _console.print(msg)
    else:
        print(msg)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Kalshi news-lag detector (detection only).")
    p.add_argument("--category", action="append", help="Category filter (repeatable). Overrides config.")
    p.add_argument("--threshold", type=float, help="Gap threshold in percentage points.")
    p.add_argument("--limit", type=int, help="Max markets to scan.")
    p.add_argument("--max-llm-calls", type=int, default=None, help="Cap on LLM scoring calls this run.")
    p.add_argument("--db", default="flagged_opportunities.db", help="SQLite DB path.")
    p.add_argument("--dry-run", action="store_true", help="Skip LLM scoring; show keyword matches only.")
    return p.parse_args()


def _close_ts_cutoff(max_days: int) -> Optional[int]:
    if not max_days or max_days <= 0:
        return None
    cutoff = datetime.now(timezone.utc) + timedelta(days=max_days)
    return int(cutoff.timestamp())


def _category_matches(profile: MarketProfile, categories: List[str]) -> bool:
    if not categories:
        return True
    prof_cat = (profile.category or "").lower()
    return any(c.lower() in prof_cat or prof_cat in c.lower() for c in categories)


def main() -> int:
    args = parse_args()
    cfg = load_config()

    # CLI overrides.
    if args.threshold is not None:
        cfg.gap_threshold_pp = args.threshold
    if args.limit is not None:
        cfg.max_markets = args.limit
    if args.category:
        cfg.categories = args.category

    # Validate credentials up front.
    try:
        cfg.require_kalshi()
        cfg.require_newsapi()
        if not args.dry_run:
            cfg.require_anthropic()
    except RuntimeError as exc:
        log(f"[red]✗ {exc}[/red]" if _RICH else f"✗ {exc}")
        return 1

    log(f"[bold]Kalshi News-Lag Detector[/bold]" if _RICH else "Kalshi News-Lag Detector")
    log(f"Categories: {cfg.categories or 'ALL'} | gap threshold: {cfg.gap_threshold_pp}pp "
        f"| max markets: {cfg.max_markets}")

    # --- 1. Markets ---
    kalshi = KalshiClient(cfg.kalshi_api_key_id, cfg.kalshi_private_key_path, cfg.kalshi_api_base)
    max_close_ts = _close_ts_cutoff(cfg.max_days_to_close)
    log("Fetching open markets…")
    raw_markets = kalshi.iter_markets(max_total=cfg.max_markets, status="open", max_close_ts=max_close_ts)

    profiles: List[MarketProfile] = []
    for m in raw_markets:
        prof = build_profile(m, keywords_per_market=cfg.keywords_per_market)
        if _category_matches(prof, cfg.categories):
            profiles.append(prof)
    log(f"  {len(raw_markets)} open markets fetched, {len(profiles)} match category filter.")

    if not profiles:
        log("No markets to scan after filtering. Adjust categories/max_days_to_close.")
        return 0

    # --- 2/3. News matching ---
    news = NewsClient(cfg.newsapi_key)
    scorer = None if args.dry_run else LLMScorer(cfg.anthropic_api_key, cfg.anthropic_model)
    storage = Storage(args.db)

    flagged: List[Dict[str, Any]] = []
    matched_count = 0
    llm_calls = 0

    for prof in profiles:
        if not prof.keywords and not prof.entities:
            continue
        try:
            articles_raw = news.search(
                prof.news_query(),
                lookback_hours=cfg.news_lookback_hours,
                page_size=cfg.news_page_size,
            )
        except Exception as exc:  # noqa: BLE001
            log(f"  [yellow]news search failed for {prof.ticker}: {exc}[/yellow]"
                if _RICH else f"  news search failed for {prof.ticker}: {exc}")
            continue

        articles = [normalize_article(a) for a in articles_raw]
        candidates = [
            a for a in articles
            if count_keyword_hits(prof, a) >= cfg.min_keyword_hits
        ]
        if not candidates:
            continue
        matched_count += 1
        # Keep the strongest few to bound LLM token cost.
        candidates.sort(key=lambda a: count_keyword_hits(prof, a), reverse=True)
        candidates = candidates[:5]

        if args.dry_run:
            log(f"  • {prof.ticker}: {len(candidates)} candidate article(s) "
                f"(YES {prof.yes_price_cents}¢) — {candidates[0]['title'][:80]}")
            continue

        if args.max_llm_calls is not None and llm_calls >= args.max_llm_calls:
            log(f"  Reached --max-llm-calls ({args.max_llm_calls}); stopping scoring.")
            break

        try:
            verdict: Verdict = scorer.score(
                market_title=prof.title,
                market_subtitle=prof.subtitle,
                current_prob=prof.implied_prob,
                articles=candidates,
                close_time=prof.close_time,
            )
            llm_calls += 1
        except Exception as exc:  # noqa: BLE001
            log(f"  [yellow]LLM scoring failed for {prof.ticker}: {exc}[/yellow]"
                if _RICH else f"  LLM scoring failed for {prof.ticker}: {exc}")
            continue

        # --- 4/5. Gap + flag ---
        if not verdict.materially_relevant:
            continue
        if verdict.confidence < cfg.min_confidence:
            continue
        if prof.yes_price_cents is None:
            continue

        gap = abs(verdict.fair_price_cents - prof.yes_price_cents)
        if gap < cfg.gap_threshold_pp:
            continue

        opp = Opportunity(
            ticker=prof.ticker,
            market_question=prof.title,
            current_price_cents=float(prof.yes_price_cents),
            estimated_fair_price_cents=verdict.fair_price_cents,
            gap_pp=round(gap, 1),
            direction=verdict.direction,
            confidence=verdict.confidence,
            news_summary=candidates[0]["title"],
            sources=[a["url"] for a in candidates if a["url"]],
            reasoning=verdict.reasoning,
            close_time=prof.close_time,
        )
        storage.insert(opp)
        flagged.append({"opp": opp, "profile": prof})

    # --- 6. Report ---
    log(f"\nScanned {len(profiles)} markets | {matched_count} had news matches | "
        f"{llm_calls} LLM call(s) | {len(flagged)} flagged.")
    _print_table(flagged)
    storage.close()
    return 0


def _print_table(flagged: List[Dict[str, Any]]) -> None:
    if not flagged:
        log("No mispricing flags this run.")
        return

    flagged.sort(key=lambda f: f["opp"].gap_pp, reverse=True)

    if _RICH:
        table = Table(title="Flagged Potential Mispricings", show_lines=True)
        table.add_column("Ticker", style="cyan", no_wrap=True)
        table.add_column("Market", style="white", max_width=40)
        table.add_column("Mkt¢", justify="right")
        table.add_column("Fair¢", justify="right", style="green")
        table.add_column("Gap", justify="right", style="bold yellow")
        table.add_column("Dir")
        table.add_column("Conf", justify="right")
        table.add_column("News", max_width=40)
        for f in flagged:
            o = f["opp"]
            table.add_row(
                o.ticker,
                o.market_question,
                f"{o.current_price_cents:.0f}",
                f"{o.estimated_fair_price_cents:.0f}",
                f"{o.gap_pp:.0f}pp",
                o.direction,
                f"{o.confidence:.2f}",
                o.news_summary,
            )
        _console.print(table)
        _console.print("\n[dim]For research/signal only — no orders placed.[/dim]")
    else:
        print("\n=== Flagged Potential Mispricings ===")
        for f in flagged:
            o = f["opp"]
            print(f"{o.ticker} | mkt {o.current_price_cents:.0f}¢ -> fair "
                  f"{o.estimated_fair_price_cents:.0f}¢ | gap {o.gap_pp:.0f}pp "
                  f"({o.direction}, conf {o.confidence:.2f})")
            print(f"    Q: {o.market_question}")
            print(f"    News: {o.news_summary}")
            print(f"    Sources: {', '.join(o.sources[:2])}")
        print("\nFor research/signal only — no orders placed.")


if __name__ == "__main__":
    sys.exit(main())
