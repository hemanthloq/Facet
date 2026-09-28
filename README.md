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
raw JSON to one Claude prompt that infers attributes and extracts values.
This works and is fine to ship as-is.

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
- Search: SerpApi (tries the Google Shopping engine first, falls back to
  general search)
- Reasoning/extraction: Claude (Anthropic API)

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
ANTHROPIC_API_KEY=...
```
Never commit `.env` — it's already in `.gitignore`.

## API contract

### POST /search
Request: `{ "query": string }`
Response:
```json
{
  "caption": "Comparing by price, RAM, battery, and rating since you're shopping for laptops",
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
2. Fall back to the general `google` engine when Shopping returns nothing (non-shopping queries).
3. One Claude call that infers 3–5 relevant attributes, extracts them per result, and writes the caption — one call, not three.
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
