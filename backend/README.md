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

## Calling it from the frontend

- Send `Content-Type: application/json`. `fetch` with a string body and no header sends
  `text/plain`, which gets a 422.
- Don't send `credentials: "include"` — CORS is `*`, which browsers reject with credentials.
- Latency: typically 11-15s. Worst case about 2.5 minutes. The server retries only 503/overload
  errors: the classify call gets 3 tries at 10s max plus 3s backoff, SerpApi up to 2 calls at
  15s each, and the extract call gets 3 tries at 30s max plus 3s backoff.
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
  503/overload errors.
