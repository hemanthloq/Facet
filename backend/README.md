# backend — /search

FastAPI service exposing `POST /search`. See project contract for request/response shape.

## Setup

```
git clone https://github.com/hemanthloq/Facet.git
cd Facet/backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` (gitignored, not included in the repo) with your own keys — do not
share keys between people testing this locally, each person should get their own free tier:

```
SERPAPI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
```

- SerpApi key: https://serpapi.com (free tier, dashboard)
- Gemini key: https://aistudio.google.com (free tier, no card needed)

## Run

```
uvicorn main:app --reload --port 8000
```

Test:

```
curl -X POST http://localhost:8000/search -H "Content-Type: application/json" -d "{\"query\": \"best laptops under 60000\"}"
```

## How /search works

1. **Routing.** Keyword rules classify the query as shopping, place or other. Only when
   the keywords find no signal, or signals for both, does an LLM call decide. Shopping
   goes to SerpApi `google_shopping`, place goes to `google_maps`, and other goes to general
   `google`. If Shopping or Maps returns nothing, the query falls back to general `google`.
2. **Columns follow the query.** Qualifying terms in the query ("for studying",
   "under 60000", "beginner") are passed to the LLM, which picks columns that answer them.
   Generic columns (rating, price, reviews) lead only when there's no such term or no
   field answers it. A term nothing answers gets no column; values are never inferred.
3. **Sparse columns are dropped.** Any column filled on fewer than half the rows is
   removed, whichever engine or LLM module produced it.
4. **`null` means "not stated in the source"**, not "no" or "false". A `null`
   `beginner_level` doesn't mean the course isn't for beginners; the result just didn't say.
   Filter and reason with that in mind (`/refine`, `/insight`).
5. **Column keys are lowercase**, with spaces as underscores and hyphens kept:
   `popular_for`, `price_range`, `wi-fi`.
6. **The caption is built in code** from the columns that survive step 3
   ("Comparing by atmosphere, wi-fi and rating."). The LLM never writes it, so it can't
   mention a dropped column.
7. **Columns can differ between runs of the same query.** Results come from live search,
   and whether a column clears the half-filled bar depends on that run's data. This is
   expected, not a bug.

## Calling it from the frontend

- Send `Content-Type: application/json`. `fetch` with a string body and no header sends
  `text/plain`, which gets a 422.
- Don't send `credentials: "include"` — CORS is `*`, which browsers reject with credentials.
- Latency: typically 4-12s (measured). Worst case about 3 minutes: LLM classify (only for
  ambiguous queries) up to ~33s, SerpApi up to ~31s per engine with 2 retries on
  timeouts/5xx, up to 2 engines when the first returns nothing, then extraction up to ~93s.
  Show a "still working" state rather than a frozen spinner.
- `fetch` does not reject on non-2xx, so check `res.ok`. Failures come back as:

| Status | Body | Meaning |
|---|---|---|
| 422 | `{"detail": [...]}` (FastAPI default) | missing/blank `query`, or body not JSON |
| 502 | `{"error": "search_unavailable", "message": "..."}` | SerpApi down, timed out, or bad key |
| 503 | `{"error": "ai_busy", "message": "..."}` | LLM rate-limited, overloaded, or timed out — retry later |
| 502 | `{"error": "ai_unavailable", "message": "..."}` | LLM rejected the request (e.g. bad key) |
| 502 | `{"error": "ai_bad_output", "message": "..."}` | LLM answered with unusable JSON — retrying usually works |
| 500 | `{"error": "internal_error", "message": "..."}` | bug on our side |

## Notes

- Currently wired to Gemini (`llm_extract.py`) for intent classification + column
  inference/extraction. `claude_extract.py` is a drop-in fallback with the same
  `classify_intent` / `infer_and_extract` interface — if Gemini's free-tier quota becomes a
  blocker, swap the two `from llm_extract import ...` lines in `main.py` and `serp_client.py`
  to `from claude_extract import ...`, and put a real `ANTHROPIC_API_KEY` in `.env`.
- `gemini-3.8-flash` hit a 20-requests/day free-tier cap during testing — we're on
  `gemini-3.1-flash-lite` instead. Both Gemini calls retry with backoff on transient
  503/504/overload errors.
