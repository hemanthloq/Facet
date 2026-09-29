# Facet — Frontend & Refinement

> **SerpApi India Hackathon 2026** · **Track: AI Agents**  
> **Team Role: Pandu** (Frontend UI, Dynamic Table, Type-Aware Sorting & Refinement)

Facet turns natural language queries into structured, intelligent comparisons. Instead of 10 blue links or a generic chatbot wall of text, Facet infers the comparison facets fresh per query, formats them into a type-aware sortable table, allows conversational follow-up refinement, and surfaces honest reviewer synthesis.

---

## 👥 Team Breakdown & API Contract

| Member | Owned Scope | API Endpoint | Status |
| :--- | :--- | :--- | :--- |
| **Heddy** | Backend Core (SerpApi + Intent Classification + LLM Extraction) | `POST /search` | Built on `main` |
| **Pandu** (This Workspace) | Frontend Application + Refinement Pipeline | `POST /refine` | **Complete** |
| **Mathin** | Reviewer Synthesis + Hackathon Pitch & Video | `POST /insight` | Integrated |

### API Contract (Fixed Single Source of Truth)
- `POST /search` &rarr; Request: `{"query": string}` &rarr; Response: `{"caption": string, "columns": string[], "rows": object[]}`
- `POST /refine` &rarr; Request: `{"query": string, "rows": object[], "instruction": string}` &rarr; Response: Same shape as `/search`
- `POST /insight` &rarr; Request: `{"row": object}` &rarr; Response: `{"pros": string[], "cons": string[], "flag": string|null}`

---

## 🎨 Built by Pandu (Frontend Features)

### 1. Plain HTML / CSS / JS (Zero Framework Bloat)
Built cleanly with zero external framework dependencies (no React/Vue/Vite/Webpack required). Can be opened directly in any browser.

### 2. Search & 3-Minute Latency Resilience
- **Input & Submission Safeguard**: Search button is disabled while requests are in flight to prevent duplicate submissions.
- **Cancel Button**: Wired to `AbortController` allowing instant cancellation of long-running queries.
- **Progressive Feedback**: Because worst-case searches with retries take up to 3 minutes, the UI features an asymptotic progress bar, animated pulse timer, and 4-step contextual milestone stages (Intent Classification &rarr; SerpApi Retrieval &rarr; Facet Inference &rarr; Grounded Extraction).

### 3. Dynamic Faceted Table Rendering
- Never assumes fixed column headers. The table dynamically shapes itself around whatever comparison columns the AI extracts (e.g. `price`, `ram`, `battery` for laptops; `atmosphere`, `price_level`, `wifi` for cafes).

### 4. Type-Aware Multi-Format Sorting
Detects value shape automatically and sorts accurately:
- **Price / Number Ranges**: e.g., `"₹90–150"` vs `"₹200–400"` &rarr; parses numeric bounds and sorts by value (not alphabetical character comparison).
- **Symbol Tiers**: e.g., `"$"`, `"$$"`, `"$$$"`, `"$$$$"` &rarr; counts symbol density.
- **Numbers with Units & Currency**: e.g., `54990`, `"₹54,990"`, `"16GB"`, `"18 hrs"`.
- **Text & Categories**: Clean alphabetical fallback.
- **Null / Missing Values**: Sinks missing/null values to the bottom.

### 5. Conversational Refinement (`/refine`)
- Users can type natural language instructions to slice and dice existing results (e.g., *"only show under 50k"*, *"only show $$"*, *"exclude Lenovo"*, *"sort by cheapest"*).
- Calls backend `POST /refine` when live, and includes an intelligent client-side fallback heuristic when backend is offline.
- Deep clones original search results so users can click **"Reset to original"** at any time.

### 6. Reviewer Insight Drawer (`/insight`)
- Clicking any row expands an inline synthesis drawer showing verified pros, cons, and caution flags.
- **Lazy Loading & Cache**: Only fetches `/insight` upon row click, and caches results so re-opening is instantaneous.

### 7. Interactive Offline Demo Mode
- If backend server is not running, clicking any query chip or search error provides an option to explore with sample comparison data immediately.

---

## 📂 Repository Structure

```text
serp/
├── .gitignore
├── README.md                  # Pandu's frontend & refinement documentation
└── frontend/
    ├── index.html             # Clean, responsive HTML5 interface
    ├── style.css              # Custom styling (IBM Plex typography, dark/light contrast)
    ├── app.js                 # Complete state management, sorting, refine & insight logic
    └── test_frontend.js       # 10 automated unit test suites for sorting & refinement
```

---

## 🚀 Running & Testing

### 1. Run Automated Unit Tests (Node.js)
```bash
node frontend/test_frontend.js
```
*Runs all 10 test suites covering range comparisons, tier symbols, currency amounts, alphabetical text, null sinking, price filters, tier filters, exclusions, sorting, and insight extraction.*

### 2. Launch Frontend Application
Double-click `frontend/index.html` to open it in your default browser, or serve locally:

**Using Python:**
```bash
python -m http.server 5500 --directory frontend
# Open http://localhost:5500
```

**Using Node / npx:**
```bash
npx serve frontend
```

### 3. Connecting to the Backend
By default, `frontend/app.js` connects to `http://localhost:8000`. When Heddy runs the FastAPI backend server (`uvicorn main:app --port 8000`), the frontend automatically routes live queries to the real SerpApi + Gemini pipeline.
