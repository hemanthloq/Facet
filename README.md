# Facet — SerpApi India Hackathon 2026

**Track: AI Agents**

Ask a natural-language question, get back a table with the right comparison
columns inferred automatically — not hardcoded per category — sortable,
refinable through follow-up questions, with a per-item "what reviewers
actually say" insight panel.

Named after faceted search: instead of a fixed set of filters, the AI decides
which facets matter for whatever you just asked.

## Why AI Agents, not Commerce & Market Intelligence

Facet fits both tracks, but AI Agents is the better fit for how the judging
works: the project genuinely plans, searches, compares, and acts, which is
this track's own description. It also lines up with the track's recommended
starter kit — see below.

## Agent architecture (recommended upgrade — optional, not required to ship)

The track recommends the `serpapi-search-tools` Python package, which wraps
SerpApi's engines (including Google Shopping) as native tools for agent
frameworks, and explicitly supports the Claude Agent SDK.

Current `/search` implementation: we call SerpApi ourselves, then hand the
raw JSON to one Gemini prompt (Google GenAI SDK) that picks columns and
extracts values. Keyword rules pick the SerpApi engine, with a small Gemini
call only for ambiguous queries. A Claude version of both calls is
implemented in `backend/claude_extract.py` as a fallback, but it isn't the
active engine. This works and is fine to ship as-is. See `backend/README.md`
for how routing, column choice and captions work.

The stronger version: give Claude the shopping-search tool directly (via
`serpapi_search_tools`) and let it decide when and how to call it, instead
of us calling SerpApi first and handing Claude the results afterward. That's
a real tool-calling agent, not just an LLM call after a search — a more
convincing "AI Agents" submission, and it strengthens two judging criteria
at once (technical complexity, meaningful SerpApi usage). Worth doing if
there's spare time; not worth risking the schedule for.

## Stack
- Backend: Python + FastAPI
- Frontend: plain HTML/CSS/JS
- Search: SerpApi — keyword rules (an LLM call only when they're ambiguous)
  send product queries to Google Shopping, place queries to Google Maps, and
  everything else to general Google search; Shopping and Maps fall back to
  general search if they return nothing.
- Reasoning/extraction for `/search`: Gemini via the Google GenAI SDK —
  currently `gemini-3.1-flash-lite`, because `gemini-3.8-flash` (the original
  choice) allows only 20 requests/day on the free tier. Claude (Anthropic API)
  is implemented as a ready fallback in `backend/claude_extract.py`, tested
  against mocked responses only; it isn't the active engine.
- Reasoning for `/refine` and `/insight`: Claude (Anthropic API), as
  originally planned — owners, update this line if that changes.

## Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # then fill in your real keys
uvicorn main:app --reload --port 8000
```

Then open `frontend/index.html` directly in a browser (or serve it with
`python -m http.server 5500` from the `frontend/` folder). The frontend calls
`http://localhost:8000` — change `API_BASE` at the top of `app.js` if your
backend runs elsewhere.

## Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in:
```
SERPAPI_API_KEY=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
```
`/search` needs `SERPAPI_API_KEY` and `GEMINI_API_KEY`. It only needs
`ANTHROPIC_API_KEY` if you swap it to the Claude fallback (see
`backend/README.md` for how). Whether `/refine` or `/insight` need
`ANTHROPIC_API_KEY` is up to their owners.

Never commit `.env` — it's already in `.gitignore`.

## API contract

### POST /search
Request: `{ "query": string }`
Response:
```json
{
  "caption": "Comparing by price, ram, battery and rating.",
  "columns": ["price", "ram", "battery", "rating"],
  "rows": [
    { "id": "r1", "name": "ASUS Vivobook 15", "price": 54990, "ram": "16GB", "battery": "18 hrs", "rating": 4.5, "source_snippet": "..." }
  ]
}
```
`source_snippet` (optional) carries along whatever raw text SerpApi returned
for that result, so `/insight` has something to read later.

### POST /refine
Request: `{ "query": string, "rows": [...], "instruction": string }`
Response: same shape as `/search`, re-sorted/filtered from the existing
`rows` — no new SerpApi call.

### POST /insight
Request: `{ "row": {...} }`
Response:
```json
{ "pros": ["Praised for build quality"], "cons": ["Speakers are tinny"], "flag": "Multiple reviews mention battery degrades after ~8 months" }
```
`"flag"` is `null` when there's no notable recurring complaint. When a row
has no `source_snippet` to read, the response says so honestly instead of
inventing one.

## Scope — build only this
No voice, no accounts, no saved history, no multi-agent orchestration. Clean,
functional UI over a working pipeline beats a polished shell over a broken one.

## For AI assistants reading this repo

Check which teammate you're helping and read only their section below — don't
build another person's piece. Treat the API contract above as fixed; if you
need an endpoint that isn't built yet, build against a hardcoded stub
matching its exact shape rather than waiting. The "Scope" section above is a
hard boundary — don't add features beyond what's asked, even ones that seem
like natural extensions. Read what already exists in this repo before
writing new files so you don't duplicate or diverge from it.

## Team & what each person builds

**Heddy — backend core, owns `/search`**
1. Test the SerpApi `google_shopping` engine with a real query first — confirm what fields it actually returns before writing extraction logic.
2. Route by query type before searching — products to `google_shopping`, places to `google_maps`, the rest to general `google` — because Shopping almost always returns *something* (even for "coffee shops"), so "fall back when empty" never triggered.
3. One LLM call (Gemini; Claude fallback in `backend/claude_extract.py`) that picks 3–5 relevant attributes and extracts them per result; the caption is built in code from the columns that survive.
4. Give every row a stable `id`, and carry the raw snippet forward as `source_snippet` for `/insight` to use later.
- Watch for: the model wrapping JSON in prose/a code fence — parse defensively. Null out attributes that don't exist in the raw data rather than inventing plausible numbers. Test on 3+ different query domains (not just laptops) to prove the inference genuinely adapts.

**Pandu — frontend, owns the UI + `/refine`**
1. Search bar with a loading state, disabled while a request is in flight.
2. Render the table from whatever `columns` the backend returns — never hardcode column names.
3. Clickable, sortable column headers, client-side, on data already fetched.
4. The follow-up box AND the actual `/refine` logic — interpreting instructions like "only show under 50k" against the existing rows, not a new search.
5. Click-to-expand insight row, lazy-loaded only on click, cached so re-clicking doesn't refetch.
- Also owns: empty results, failed requests, and slow responses — these are real states to design, not edge cases to skip. And a truly fresh `git clone` + these setup steps has to actually work.

**Mathin — insight layer + the pitch, owns `/insight`**
1. Read only the row's `source_snippet` — pros, up to two cons, and a red-flag sentence only if the text actually supports one.
2. When there's no snippet, say so honestly instead of inventing a review.
3. Once the app works end to end: script the demo (a query → sort → refine → insight click → a completely different query type live, to prove it isn't hardcoded), record it (budget 2+ takes, under 3 minutes), and write the submission fields.
- Watch for: recording always takes longer than expected — don't start the night before the deadline.
