"""
Minimal Kalshi REST API (v2) client with correct request signing.

Kalshi authenticates each request by signing a message with your RSA private
key (NOT a bearer token). The scheme, per Kalshi's docs:

  message   = timestamp_ms + HTTP_METHOD + request_path
  signature = base64( RSA-PSS-SHA256.sign(private_key, message) )

Three headers are attached to every request:
  KALSHI-ACCESS-KEY        -> your API key ID (a UUID)
  KALSHI-ACCESS-SIGNATURE  -> the base64 signature above
  KALSHI-ACCESS-TIMESTAMP  -> the timestamp in milliseconds (same one signed)

Notes:
  * `request_path` is the path portion only, INCLUDING the "/trade-api/v2"
    prefix but EXCLUDING the query string. e.g. "/trade-api/v2/markets".
  * PSS salt length must equal the digest length (SHA-256 => 32 bytes).
"""

from __future__ import annotations

import base64
import datetime
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey


class KalshiAuthError(Exception):
    pass


class KalshiClient:
    def __init__(self, api_key_id: str, private_key_path: str, api_base: str):
        self.api_key_id = api_key_id
        self.api_base = api_base.rstrip("/")
        # The base path (e.g. "/trade-api/v2") is part of what we sign.
        self._base_path = urlparse(self.api_base).path.rstrip("/")
        self._private_key = self._load_private_key(private_key_path)
        self._session = requests.Session()

    # ------------------------------------------------------------------ #
    # Signing
    # ------------------------------------------------------------------ #
    @staticmethod
    def _load_private_key(path: str) -> RSAPrivateKey:
        with open(path, "rb") as fh:
            key = serialization.load_pem_private_key(fh.read(), password=None)
        if not isinstance(key, RSAPrivateKey):
            raise KalshiAuthError(
                "Loaded key is not an RSA private key. Kalshi issues RSA keys."
            )
        return key

    def _sign(self, text: str) -> str:
        signature = self._private_key.sign(
            text.encode("utf-8"),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _auth_headers(self, method: str, path: str) -> Dict[str, str]:
        # Milliseconds since epoch, as an integer string.
        timestamp_ms = str(int(datetime.datetime.now().timestamp() * 1000))
        # Sign timestamp + METHOD + path (path excludes query string).
        message = timestamp_ms + method.upper() + path
        signature = self._sign(message)
        return {
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-SIGNATURE": signature,
            "KALSHI-ACCESS-TIMESTAMP": timestamp_ms,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    # ------------------------------------------------------------------ #
    # Core request
    # ------------------------------------------------------------------ #
    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        retries: int = 3,
    ) -> Dict[str, Any]:
        """
        `endpoint` is relative to the base, e.g. "/markets".
        The signed path is base_path + endpoint (query string excluded).
        """
        endpoint = "/" + endpoint.lstrip("/")
        sign_path = self._base_path + endpoint
        url = self.api_base + endpoint

        last_err: Optional[Exception] = None
        for attempt in range(retries):
            headers = self._auth_headers(method, sign_path)
            try:
                resp = self._session.request(
                    method, url, headers=headers, params=params, timeout=30
                )
            except requests.RequestException as exc:
                last_err = exc
                time.sleep(2 ** attempt)
                continue

            if resp.status_code == 401:
                raise KalshiAuthError(
                    f"401 Unauthorized from Kalshi. Check your key ID, private "
                    f"key, and that your clock is accurate. Body: {resp.text[:300]}"
                )
            if resp.status_code == 429:
                # Rate limited — back off and retry.
                time.sleep(2 ** attempt)
                last_err = RuntimeError("429 rate limited")
                continue
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Kalshi {method} {endpoint} failed "
                    f"({resp.status_code}): {resp.text[:300]}"
                )
            return resp.json()

        raise RuntimeError(f"Kalshi request failed after {retries} tries: {last_err}")

    # ------------------------------------------------------------------ #
    # Public endpoints
    # ------------------------------------------------------------------ #
    def get_balance(self) -> Dict[str, Any]:
        """Fetch account balance — a good, cheap way to verify auth works."""
        return self._request("GET", "/portfolio/balance")

    def get_exchange_status(self) -> Dict[str, Any]:
        """Exchange trading/heartbeat status (does not require auth, but we
        send auth headers anyway; handy connectivity check)."""
        return self._request("GET", "/exchange/status")

    def get_markets(
        self,
        limit: int = 100,
        status: str = "open",
        cursor: Optional[str] = None,
        category: Optional[str] = None,
        max_close_ts: Optional[int] = None,
        min_close_ts: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Single page of markets. Prefer `iter_markets` for convenience."""
        params: Dict[str, Any] = {"limit": min(limit, 1000), "status": status}
        if cursor:
            params["cursor"] = cursor
        if category:
            params["category"] = category
        if max_close_ts:
            params["max_close_ts"] = max_close_ts
        if min_close_ts:
            params["min_close_ts"] = min_close_ts
        return self._request("GET", "/markets", params=params)

    def iter_markets(
        self,
        max_total: int = 100,
        status: str = "open",
        category: Optional[str] = None,
        max_close_ts: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch up to `max_total` markets, following the cursor pagination.
        Kalshi's `category` filter is applied server-side when supported; we
        also filter client-side in the runner as a safety net.
        """
        out: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        while len(out) < max_total:
            page = self.get_markets(
                limit=min(1000, max_total - len(out)),
                status=status,
                cursor=cursor,
                category=category,
                max_close_ts=max_close_ts,
            )
            markets = page.get("markets", [])
            out.extend(markets)
            cursor = page.get("cursor")
            if not cursor or not markets:
                break
        return out[:max_total]

    def get_market(self, ticker: str) -> Dict[str, Any]:
        return self._request("GET", f"/markets/{ticker}")
