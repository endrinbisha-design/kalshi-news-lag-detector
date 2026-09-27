#!/usr/bin/env python3
"""
Standalone Kalshi auth smoke test.

Run this FIRST, before anything else, to confirm your API key ID + RSA private
key are working. It does NOT touch news or the LLM — just authenticates against
Kalshi and prints your balance plus a couple of open markets.

Usage:
    python test_auth.py

Requires (in your environment or .env):
    KALSHI_API_KEY_ID
    KALSHI_PRIVATE_KEY_PATH
    KALSHI_API_BASE       (optional; defaults to production)
"""

from __future__ import annotations

import sys

from config import load_config
from kalshi_client import KalshiAuthError, KalshiClient


def main() -> int:
    cfg = load_config()
    try:
        cfg.require_kalshi()
    except RuntimeError as exc:
        print(f"✗ {exc}")
        return 1

    print(f"Connecting to Kalshi at: {cfg.kalshi_api_base}")
    print(f"Using key ID: {cfg.kalshi_api_key_id[:8]}…")

    client = KalshiClient(
        api_key_id=cfg.kalshi_api_key_id,
        private_key_path=cfg.kalshi_private_key_path,
        api_base=cfg.kalshi_api_base,
    )

    # 1) Exchange status — light connectivity check.
    try:
        status = client.get_exchange_status()
        print(f"✓ Exchange status: {status}")
    except Exception as exc:  # noqa: BLE001
        print(f"⚠ Could not fetch exchange status: {exc}")

    # 2) Balance — proves the signature is accepted for authed endpoints.
    try:
        balance = client.get_balance()
        cents = balance.get("balance")
        if cents is not None:
            print(f"✓ Auth OK. Account balance: ${cents / 100:,.2f}")
        else:
            print(f"✓ Auth OK. Balance response: {balance}")
    except KalshiAuthError as exc:
        print(f"✗ Authentication failed: {exc}")
        print("  - Double-check KALSHI_API_KEY_ID matches the downloaded key.")
        print("  - Ensure KALSHI_PRIVATE_KEY_PATH points at the correct .pem.")
        print("  - Make sure your system clock is accurate (signature uses time).")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"✗ Balance request failed: {exc}")
        return 1

    # 3) A few open markets — proves market data reads work.
    try:
        markets = client.iter_markets(max_total=3, status="open")
        print(f"✓ Fetched {len(markets)} open market(s):")
        for m in markets:
            price = m.get("last_price") or m.get("yes_bid") or "?"
            print(f"    - {m.get('ticker')}: {m.get('title')}  (YES ~{price}¢)")
    except Exception as exc:  # noqa: BLE001
        print(f"✗ Market fetch failed: {exc}")
        return 1

    print("\nAll checks passed. You're ready to run the detector (main.py).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
