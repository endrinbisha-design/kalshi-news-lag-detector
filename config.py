"""
Central configuration loading for the Kalshi News-Lag Detector.

Precedence:
  1. `config.yaml` (tuning knobs only) — highest priority for tuning values
  2. Environment variables (from the shell or a `.env` file)
  3. Hard-coded defaults below

Secrets (API keys, private key path) are ALWAYS read from the environment,
never from config.yaml — keep secrets out of files that might be shared.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

try:
    from dotenv import load_dotenv

    load_dotenv()  # loads .env into os.environ if present
except ImportError:  # pragma: no cover - dotenv is optional at runtime
    pass

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


DEFAULT_KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
DEFAULT_MODEL = "claude-sonnet-5"


@dataclass
class Config:
    # --- Secrets / connection (env only) ---
    kalshi_api_key_id: str = ""
    kalshi_private_key_path: str = ""
    kalshi_api_base: str = DEFAULT_KALSHI_BASE
    newsapi_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = DEFAULT_MODEL

    # --- Tuning knobs (config.yaml overrides env overrides defaults) ---
    gap_threshold_pp: float = 5.0
    categories: List[str] = field(default_factory=lambda: ["Politics", "Economics", "Weather"])
    max_markets: int = 100
    max_days_to_close: int = 30
    keywords_per_market: int = 8
    min_keyword_hits: int = 2
    news_lookback_hours: int = 24
    news_page_size: int = 20
    min_confidence: float = 0.5

    def require_kalshi(self) -> None:
        """Raise a clear error if Kalshi credentials are missing."""
        missing = []
        if not self.kalshi_api_key_id:
            missing.append("KALSHI_API_KEY_ID")
        if not self.kalshi_private_key_path:
            missing.append("KALSHI_PRIVATE_KEY_PATH")
        if missing:
            raise RuntimeError(
                "Missing Kalshi credentials: "
                + ", ".join(missing)
                + ". Set them in your environment or .env file (see .env.example)."
            )
        if not Path(self.kalshi_private_key_path).expanduser().exists():
            raise RuntimeError(
                f"Kalshi private key file not found at "
                f"'{self.kalshi_private_key_path}'. "
                "Point KALSHI_PRIVATE_KEY_PATH at your downloaded .pem file."
            )

    def require_newsapi(self) -> None:
        if not self.newsapi_key or self.newsapi_key == "your_newsapi_key_here":
            raise RuntimeError(
                "Missing NEWSAPI_KEY. Get a free key at https://newsapi.org/register "
                "and set it in your environment or .env file."
            )

    def require_anthropic(self) -> None:
        if not self.anthropic_api_key or self.anthropic_api_key == "your_anthropic_key_here":
            raise RuntimeError(
                "Missing ANTHROPIC_API_KEY. Set it in your environment or .env file."
            )


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def load_config(config_path: str = "config.yaml") -> Config:
    """Build a Config from env vars, then overlay config.yaml tuning knobs."""
    cfg = Config(
        kalshi_api_key_id=_env("KALSHI_API_KEY_ID"),
        kalshi_private_key_path=_env("KALSHI_PRIVATE_KEY_PATH"),
        kalshi_api_base=_env("KALSHI_API_BASE", DEFAULT_KALSHI_BASE),
        newsapi_key=_env("NEWSAPI_KEY"),
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        anthropic_model=_env("ANTHROPIC_MODEL", DEFAULT_MODEL),
    )

    # Env-provided tuning fallback (config.yaml still wins below).
    gap_env = _env("GAP_THRESHOLD_PP")
    if gap_env:
        try:
            cfg.gap_threshold_pp = float(gap_env)
        except ValueError:
            pass

    # Overlay config.yaml tuning knobs if the file exists.
    path = Path(config_path)
    if path.exists():
        if yaml is None:
            raise RuntimeError(
                "config.yaml found but PyYAML is not installed. "
                "Run: pip install -r requirements.txt"
            )
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        for key in (
            "gap_threshold_pp",
            "categories",
            "max_markets",
            "max_days_to_close",
            "keywords_per_market",
            "min_keyword_hits",
            "news_lookback_hours",
            "news_page_size",
            "min_confidence",
        ):
            if key in data and data[key] is not None:
                setattr(cfg, key, data[key])

    return cfg
