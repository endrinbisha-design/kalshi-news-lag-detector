"""
LLM scoring via Claude.

Given a market and a matched news article (or cluster of articles), ask Claude
to judge:
  a) whether the news is materially relevant to the market's outcome,
  b) the direction + rough magnitude of the implied probability shift,
  c) an estimated "fair" YES probability given the news,
  d) a confidence score.

We use tool-use with a forced schema so the model MUST return well-formed JSON
matching our structure (no fragile free-text parsing).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from anthropic import Anthropic


# The forced-output schema. tool_choice pins the model to this shape.
VERDICT_TOOL = {
    "name": "record_verdict",
    "description": "Record a structured verdict on whether news implies a "
                   "Kalshi market is mispriced.",
    "input_schema": {
        "type": "object",
        "properties": {
            "materially_relevant": {
                "type": "boolean",
                "description": "True if the news materially bears on the "
                               "market's YES/NO outcome.",
            },
            "direction": {
                "type": "string",
                "enum": ["up", "down", "none"],
                "description": "Does the news push the YES probability up, "
                               "down, or not at all?",
            },
            "estimated_fair_probability": {
                "type": "number",
                "description": "Your estimate of the fair YES probability "
                               "(0.0-1.0) AFTER accounting for this news.",
            },
            "magnitude_pp": {
                "type": "number",
                "description": "Rough magnitude of the probability shift the "
                               "news implies, in percentage points (0-100).",
            },
            "confidence": {
                "type": "number",
                "description": "Your confidence in this verdict, 0.0-1.0.",
            },
            "reasoning": {
                "type": "string",
                "description": "1-3 sentence justification.",
            },
        },
        "required": [
            "materially_relevant",
            "direction",
            "estimated_fair_probability",
            "magnitude_pp",
            "confidence",
            "reasoning",
        ],
    },
}

SYSTEM_PROMPT = (
    "You are a careful prediction-market analyst. You are given a Kalshi "
    "market (a YES/NO question with a current implied probability) and one or "
    "more recent news items. Judge whether the news is materially relevant to "
    "the market's outcome and, if so, what fair YES probability the news "
    "implies. Be conservative: most news does NOT move a specific market. "
    "Only assign high confidence when the connection is direct and the market "
    "price clearly has not yet reflected the news. You are NOT trading; you "
    "are flagging possible mispricing windows for a human to review."
)


@dataclass
class Verdict:
    materially_relevant: bool
    direction: str
    estimated_fair_probability: float
    magnitude_pp: float
    confidence: float
    reasoning: str

    @property
    def fair_price_cents(self) -> float:
        return round(self.estimated_fair_probability * 100, 1)


class LLMScorer:
    def __init__(self, api_key: str, model: str):
        self.client = Anthropic(api_key=api_key)
        self.model = model

    def score(
        self,
        market_title: str,
        market_subtitle: str,
        current_prob: Optional[float],
        articles: List[Dict[str, Any]],
        close_time: Optional[str] = None,
    ) -> Verdict:
        current_str = (
            f"{current_prob * 100:.1f}%" if current_prob is not None else "unknown"
        )
        articles_block = "\n\n".join(
            f"[{i + 1}] {a.get('title', '')}\n"
            f"Source: {a.get('source', '')} | Published: {a.get('published_at', '')}\n"
            f"{a.get('description', '')}\n{a.get('content', '')}".strip()
            for i, a in enumerate(articles)
        )

        user_prompt = (
            f"MARKET QUESTION: {market_title}\n"
            f"DETAIL: {market_subtitle}\n"
            f"CURRENT MARKET-IMPLIED YES PROBABILITY: {current_str}\n"
            f"MARKET CLOSES: {close_time or 'unknown'}\n\n"
            f"RECENT NEWS:\n{articles_block}\n\n"
            "Assess relevance and, if relevant, the fair YES probability the "
            "news implies. Call record_verdict with your structured answer."
        )

        resp = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[VERDICT_TOOL],
            tool_choice={"type": "tool", "name": "record_verdict"},
            messages=[{"role": "user", "content": user_prompt}],
        )

        payload = _extract_tool_input(resp)
        return Verdict(
            materially_relevant=bool(payload.get("materially_relevant", False)),
            direction=str(payload.get("direction", "none")),
            estimated_fair_probability=_clamp01(
                float(payload.get("estimated_fair_probability", 0.0))
            ),
            magnitude_pp=float(payload.get("magnitude_pp", 0.0)),
            confidence=_clamp01(float(payload.get("confidence", 0.0))),
            reasoning=str(payload.get("reasoning", "")),
        )


def _extract_tool_input(resp: Any) -> Dict[str, Any]:
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "record_verdict":
            return block.input
    # Fallback: try to parse any text as JSON.
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            try:
                return json.loads(block.text)
            except (json.JSONDecodeError, TypeError):
                continue
    raise RuntimeError("LLM did not return a structured verdict.")


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))
