"""
SQLite storage for flagged mispricing opportunities.

One table, append-only. Each run inserts rows for markets whose LLM-estimated
fair price diverges from the market price by more than the configured gap.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

DEFAULT_DB_PATH = "flagged_opportunities.db"


@dataclass
class Opportunity:
    ticker: str
    market_question: str
    current_price_cents: Optional[float]
    estimated_fair_price_cents: float
    gap_pp: float
    direction: str
    confidence: float
    news_summary: str
    sources: List[str] = field(default_factory=list)
    reasoning: str = ""
    close_time: Optional[str] = None
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    market_question TEXT NOT NULL,
    current_price_cents REAL,
    estimated_fair_price_cents REAL NOT NULL,
    gap_pp REAL NOT NULL,
    direction TEXT,
    confidence REAL,
    news_summary TEXT,
    sources TEXT,               -- JSON array of URLs
    reasoning TEXT,
    close_time TEXT,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_ticker ON opportunities(ticker);
CREATE INDEX IF NOT EXISTS idx_opp_timestamp ON opportunities(timestamp);
"""


class Storage:
    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path)
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def insert(self, opp: Opportunity) -> int:
        cur = self._conn.execute(
            """
            INSERT INTO opportunities (
                ticker, market_question, current_price_cents,
                estimated_fair_price_cents, gap_pp, direction, confidence,
                news_summary, sources, reasoning, close_time, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                opp.ticker,
                opp.market_question,
                opp.current_price_cents,
                opp.estimated_fair_price_cents,
                opp.gap_pp,
                opp.direction,
                opp.confidence,
                opp.news_summary,
                json.dumps(opp.sources),
                opp.reasoning,
                opp.close_time,
                opp.timestamp,
            ),
        )
        self._conn.commit()
        return cur.lastrowid

    def recent(self, limit: int = 50) -> List[dict]:
        cur = self._conn.execute(
            "SELECT * FROM opportunities ORDER BY id DESC LIMIT ?", (limit,)
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def close(self):
        self._conn.close()
