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

## Notes

- Currently wired to Gemini (`llm_extract.py`) for intent classification + column
  inference/extraction. `claude_extract.py` is a drop-in fallback with the same
  `classify_intent` / `infer_and_extract` interface — if Gemini's free-tier quota becomes a
  blocker, swap the two `from llm_extract import ...` lines in `main.py` and `serp_client.py`
  to `from claude_extract import ...`, and put a real `ANTHROPIC_API_KEY` in `.env`.
- `gemini-3.8-flash` hit a 20-requests/day free-tier cap during testing — we're on
  `gemini-3.1-flash-lite` instead. Both Gemini calls retry with backoff on transient
  503/overload errors.
