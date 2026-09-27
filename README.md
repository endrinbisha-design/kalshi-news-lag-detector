# Kalshi News-Lag Detector

A personal **research / signal-generation** tool. It monitors recent news for
events relevant to open [Kalshi](https://kalshi.com) prediction markets and
flags markets whose price may **not yet reflect** the news — a possible
mispricing window.

> ⚠️ **This is a detector, not a trader.** It places **no orders**. It only
> reads market data, matches news, scores relevance with an LLM, and logs
> flagged opportunities for you to review manually.

---

## How it works

```
Kalshi open markets ──▶ keyword/entity profile ──▶ NewsAPI search
                                                          │
                                                keyword-overlap filter
                                                          │
                                                  Claude relevance +
                                                  fair-probability scoring
                                                          │
                                    |fair − market| > threshold?  ──▶ flag
                                                          │
                                          SQLite log + console table
```

Modules:

| File | Responsibility |
|------|----------------|
| `config.py` | Load config from env / `.env` / `config.yaml` |
| `kalshi_client.py` | Kalshi v2 REST client + RSA-PSS request signing |
| `news_client.py` | NewsAPI.org `/everything` client |
| `market_profiler.py` | Keyword/entity extraction + news matching |
| `llm_scorer.py` | Claude scoring (forced-JSON verdict) |
| `storage.py` | SQLite logging of flagged opportunities |
| `main.py` | One-off runner tying it all together |
| `test_auth.py` | Standalone Kalshi auth smoke test |

---

## Setup

### 1. Install dependencies

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Get your credentials

**Kalshi API key** (RSA key pair, not a bearer token):
1. Log in to Kalshi → **Profile → API Keys → Create New Key**.
2. You'll get a **Key ID** (a UUID) and a **downloaded RSA private key** (`.pem`).
   The private key is shown **once** — save it somewhere safe and gitignored.

**NewsAPI key:** register free at <https://newsapi.org/register>.
> Note: the free tier delays articles ~24h and caps you at 100 requests/day —
> fine for validating the logic, but you'll want a paid plan (or GDELT/RSS) for
> real-time signal.

**Anthropic key:** from the [Anthropic Console](https://console.anthropic.com/).

### 3. Configure

```bash
cp .env.example .env
# then edit .env and fill in the TODOs
```

`.env` (gitignored) holds **secrets**:

```dotenv
KALSHI_API_KEY_ID=your-key-id-uuid
KALSHI_PRIVATE_KEY_PATH=./kalshi_private_key.pem
KALSHI_API_BASE=https://api.elections.kalshi.com/trade-api/v2
NEWSAPI_KEY=your-newsapi-key
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-5
GAP_THRESHOLD_PP=5
```

Optionally copy `config.yaml.example → config.yaml` (also gitignored) to tune
categories, thresholds, and matching knobs. `config.yaml` overrides env for
tuning values; secrets always come from the environment.

> **Never commit** `.env`, `config.yaml`, or any `*.pem` — they're in
> `.gitignore`.

---

## Verify auth first

Before running the detector, confirm your Kalshi key works:

```bash
python test_auth.py
```

Expected: exchange status, your account balance, and a few open markets.
If you see a `401`, re-check the key ID, the `.pem` path, and your system clock
(the signature is time-based).

---

## Run the detector

```bash
python main.py
```

Useful flags:

```bash
python main.py --dry-run              # show keyword matches, skip the LLM (free)
python main.py --category Politics    # override category filter (repeatable)
python main.py --threshold 8          # gap threshold in percentage points
python main.py --limit 25             # cap markets scanned
python main.py --max-llm-calls 20     # cap paid LLM calls this run
```

**Start with `--dry-run`** to see which markets are getting news matches before
spending on LLM calls.

Output:
- A console table of flagged markets (ticker, market price, estimated fair
  price, gap, direction, confidence, news headline).
- Rows appended to `flagged_opportunities.db` (SQLite) with ticker, question,
  prices, gap, news summary, sources, reasoning, and timestamp.

Inspect the DB:

```bash
sqlite3 flagged_opportunities.db "SELECT ticker, gap_pp, direction, confidence, news_summary FROM opportunities ORDER BY id DESC LIMIT 10;"
```

---

## Tuning the signal

| Knob (config.yaml) | Effect |
|--------------------|--------|
| `gap_threshold_pp` | Bigger = fewer, higher-conviction flags (default **5**) |
| `min_confidence` | LLM confidence floor to flag (default 0.5) |
| `min_keyword_hits` | Overlap needed before spending an LLM call |
| `news_lookback_hours` | How fresh the news must be |
| `categories` | Which market categories to scan |
| `max_days_to_close` | Focus on near-term markets that react to news |

---

## Notes, caveats & TODOs

- **Model choice:** `claude-sonnet-5` is a good default. Use
  `claude-haiku-4-5-20251001` to cut cost, or `claude-opus-4-8` for the
  hardest judgment calls. Set via `ANTHROPIC_MODEL`.
- **NewsAPI free-tier delay** means "news-lag" detection is approximate on the
  free plan. `news_client.py` is deliberately isolated so you can swap in
  GDELT or RSS later. `# TODO` markers flag the seams.
- **Keyword matching is intentionally crude** (`market_profiler.py`). It's a
  cheap pre-filter so the LLM only sees plausible matches; improve it (embeddings,
  NER) if precision matters.
- **No dedupe across runs yet** — the same opportunity can be logged on repeated
  runs. `# TODO`: add a uniqueness check on (ticker, news url) before scheduling.
- **Not a daemon.** Run it manually to validate. Once you trust it, wrap `main.py`
  in cron / a scheduler.
- **This does not trade.** Order execution is deliberately out of scope.

---

## Disclaimer

For personal research and signal generation only. Not financial advice. Markets
are risky; the LLM's "fair price" is an estimate, not truth. Verify everything
before acting.
