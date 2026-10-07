# Trading Interview Daily Prep

Source for the published tracker page: https://claude.ai/artifact/RqHNvuFReYk5StfVmERku7

- `index.html` is the page. It stores everything in the artifact's own database (`db` capability).
- `seed_2026-10-07.py` built and checked the first day's set.
- The routine "Trading prep daily set" (6:45 AM America/Chicago) writes each new day into the database.

Database collections: `days/<date>` (the set), `results/<date>` (checkboxes, scores, Got it / Missed it marks),
`queue/<problemId>` (missed problems queued for the next set), `meta/state` (last run, focus, difficulty levels).
