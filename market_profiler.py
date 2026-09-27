"""
Turn a Kalshi market into a lightweight keyword/entity profile, and match
news articles against that profile.

This is intentionally simple (no ML): it extracts salient terms from the
market's title/subtitle so we can (a) build a NewsAPI query and (b) count
keyword overlap with returned articles to decide which are worth the (paid)
LLM scoring step. The LLM does the real relevance judgment later.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Common English + prediction-market boilerplate words to ignore.
STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "by", "at",
    "will", "be", "is", "are", "was", "were", "than", "then", "with", "as",
    "from", "into", "over", "under", "up", "down", "out", "this", "that",
    "these", "those", "it", "its", "if", "how", "what", "when", "who", "which",
    "market", "markets", "yes", "no", "before", "after", "between", "above",
    "below", "reach", "reaches", "hit", "hits", "close", "closes", "end",
    "value", "level", "number", "many", "more", "less", "least", "most",
    "any", "all", "per", "vs", "vs.", "get", "gets", "make", "makes",
}

# Month names help us keep date-ish context out of keyword noise but they can
# also be meaningful; we keep them but down-weight single-token generic words.
_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9\.\-']+")

# Capitalized words that begin a market question but are NOT part of a named
# entity (question words, auxiliaries). Stripped from the front of entities.
_LEADING_NONENTITY = {
    "will", "what", "when", "who", "which", "how", "does", "do", "is", "are",
    "was", "were", "should", "can", "could", "would", "did", "by", "before",
    "after", "at", "in", "on", "the", "a", "an",
}
# Purely-lowercase connector words we allow *inside* an entity but must trim
# from either end.
_ENTITY_CONNECTORS = {"of", "the", "and"}


@dataclass
class MarketProfile:
    ticker: str
    title: str
    subtitle: str
    category: str
    yes_price_cents: Optional[int]          # last/mid price in cents (0-100)
    implied_prob: Optional[float]           # 0.0 - 1.0
    close_time: Optional[str]               # ISO string
    keywords: List[str] = field(default_factory=list)
    entities: List[str] = field(default_factory=list)  # capitalized multi-word phrases
    raw: Dict[str, Any] = field(default_factory=dict)

    def news_query(self) -> str:
        """Build an OR/AND-ish NewsAPI query string from the profile.

        We OR the top entities/keywords so the search is broad; the keyword-hit
        filter + LLM narrow it down afterwards.
        """
        terms = self.entities[:3] + [k for k in self.keywords if k not in " ".join(self.entities).lower()]
        terms = terms[:6]
        quoted = [f'"{t}"' if " " in t else t for t in terms]
        return " OR ".join(quoted) if quoted else self.title


def _tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text or "")]


def _extract_entities(text: str) -> List[str]:
    """Grab capitalized multi-word phrases as crude named entities.

    e.g. "Federal Reserve", "Donald Trump", "New York". Not perfect, but good
    enough to anchor a news search without an NLP dependency.
    """
    entities: List[str] = []
    # Match runs of Capitalized Words (allowing internal lowercase like "of").
    for match in re.finditer(
        r"\b([A-Z][a-zA-Z'\.]+(?:\s+(?:of|the|and)?\s*[A-Z][a-zA-Z'\.]+)+)\b",
        text or "",
    ):
        phrase = re.sub(r"\s+", " ", match.group(1)).strip()
        words = phrase.split()
        # Trim leading question/aux words ("Will", "What", ...) and any
        # leading/trailing bare connectors ("the", "of", "and").
        while words and words[0].lower() in (_LEADING_NONENTITY | _ENTITY_CONNECTORS):
            words.pop(0)
        while words and words[-1].lower() in _ENTITY_CONNECTORS:
            words.pop()
        if len(words) >= 2:
            entities.append(" ".join(words))
    # De-dup, preserve order.
    seen = set()
    out = []
    for e in entities:
        low = e.lower()
        if low not in seen:
            seen.add(low)
            out.append(e)
    return out


def build_profile(market: Dict[str, Any], keywords_per_market: int = 8) -> MarketProfile:
    """Create a MarketProfile from a raw Kalshi market dict."""
    title = market.get("title") or market.get("yes_sub_title") or ""
    subtitle = market.get("subtitle") or market.get("yes_sub_title") or ""
    category = market.get("category") or ""
    text = f"{title} {subtitle}".strip()

    entities = _extract_entities(text)

    # Keyword extraction: lowercase tokens, drop stopwords/short/pure-numbers.
    tokens = _tokenize(text)
    keywords: List[str] = []
    seen = set()
    for tok in tokens:
        low = tok.lower().strip(".'-")
        if len(low) < 3 or low in STOPWORDS or low.isdigit():
            continue
        if low in seen:
            continue
        seen.add(low)
        keywords.append(low)
    keywords = keywords[:keywords_per_market]

    # Price: Kalshi returns cents (0-100). Prefer last_price, fall back to
    # midpoint of bid/ask, then yes_bid.
    yes_price = _pick_price(market)
    implied = (yes_price / 100.0) if yes_price is not None else None

    return MarketProfile(
        ticker=market.get("ticker", ""),
        title=title,
        subtitle=subtitle,
        category=category,
        yes_price_cents=yes_price,
        implied_prob=implied,
        close_time=market.get("close_time"),
        keywords=keywords,
        entities=entities,
        raw=market,
    )


def _pick_price(market: Dict[str, Any]) -> Optional[int]:
    """Best-available YES price in cents (0-100)."""
    last = market.get("last_price")
    if isinstance(last, (int, float)) and last > 0:
        return int(last)
    bid = market.get("yes_bid")
    ask = market.get("yes_ask")
    if isinstance(bid, (int, float)) and isinstance(ask, (int, float)) and (bid or ask):
        return int(round((bid + ask) / 2))
    if isinstance(bid, (int, float)) and bid:
        return int(bid)
    return None


def count_keyword_hits(profile: MarketProfile, article: Dict[str, Any]) -> int:
    """How many of the market's keywords/entities appear in an article."""
    haystack = " ".join(
        str(article.get(f) or "")
        for f in ("title", "description", "content")
    ).lower()
    hits = 0
    matched: set = set()
    for kw in profile.keywords:
        if kw in haystack and kw not in matched:
            hits += 1
            matched.add(kw)
    for ent in profile.entities:
        el = ent.lower()
        if el in haystack and el not in matched:
            hits += 2  # entities are stronger signals
            matched.add(el)
    return hits
