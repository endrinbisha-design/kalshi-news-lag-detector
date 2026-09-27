"""
NewsAPI.org client.

Thin wrapper around the /v2/everything endpoint. We query per-market using the
keyword/entity profile, then hand candidate articles to the matcher/LLM.

Docs: https://newsapi.org/docs/endpoints/everything

Free-tier caveats (worth knowing before you trust results):
  * Results are delayed ~24h on the free plan.
  * 100 requests/day cap.
  * Cannot search articles older than ~1 month.
Consider a paid plan (or swapping in GDELT/RSS) for real-time signal.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

NEWSAPI_EVERYTHING = "https://newsapi.org/v2/everything"


class NewsAPIError(Exception):
    pass


class NewsClient:
    def __init__(self, api_key: str):
        if not api_key:
            raise NewsAPIError("NewsAPI key is required.")
        self.api_key = api_key
        self._session = requests.Session()

    def search(
        self,
        query: str,
        lookback_hours: int = 24,
        page_size: int = 20,
        language: str = "en",
        sort_by: str = "publishedAt",
        retries: int = 3,
    ) -> List[Dict[str, Any]]:
        """Return a list of article dicts for `query`."""
        from_dt = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
        params = {
            "q": query,
            "from": from_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "sortBy": sort_by,
            "language": language,
            "pageSize": min(page_size, 100),
            "apiKey": self.api_key,
        }

        last_err: Optional[Exception] = None
        for attempt in range(retries):
            try:
                resp = self._session.get(NEWSAPI_EVERYTHING, params=params, timeout=30)
            except requests.RequestException as exc:
                last_err = exc
                time.sleep(2 ** attempt)
                continue

            if resp.status_code == 429:
                # Rate limited / daily cap. Back off; caller may hit the cap.
                time.sleep(2 ** attempt)
                last_err = NewsAPIError("429 from NewsAPI (rate limit / daily cap)")
                continue
            if resp.status_code == 401:
                raise NewsAPIError(
                    "401 from NewsAPI — check your NEWSAPI_KEY."
                )
            if resp.status_code >= 400:
                # NewsAPI returns a JSON error body with a helpful message.
                try:
                    msg = resp.json().get("message", resp.text[:200])
                except Exception:
                    msg = resp.text[:200]
                raise NewsAPIError(f"NewsAPI error {resp.status_code}: {msg}")

            data = resp.json()
            if data.get("status") != "ok":
                raise NewsAPIError(f"NewsAPI returned status={data.get('status')}: "
                                   f"{data.get('message')}")
            return data.get("articles", [])

        raise NewsAPIError(f"NewsAPI request failed after {retries} tries: {last_err}")


def normalize_article(article: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a NewsAPI article to the fields we care about."""
    source = article.get("source") or {}
    return {
        "title": article.get("title") or "",
        "description": article.get("description") or "",
        "content": article.get("content") or "",
        "url": article.get("url") or "",
        "source": source.get("name") or "",
        "published_at": article.get("publishedAt") or "",
    }
