import json
import os
import time

from dotenv import load_dotenv
load_dotenv()

from google import genai

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
_MODEL = "gemini-3.1-flash-lite"  # gemini-3.8-flash hit its 20-req/day free-tier cap during testing

_EXTRACT_SYSTEM = """You turn raw search results into a structured comparison table.

Given a user's query and a list of raw result items, you must:
1. Infer 3-5 column attributes that actually matter for comparing THIS kind of thing
   (laptops get RAM/battery/price; restaurants get cuisine/price-range/rating; courses
   get duration/price/level). Do not default to laptop-shaped columns for non-laptop queries.
2. For each item, extract values using ONLY what's in the raw data given to you. If an
   attribute genuinely isn't present for an item, set it to null. NEVER invent or estimate
   a plausible-looking value.
3. Write one short caption sentence explaining what you're comparing by and why.

Raw items include both a numeric "price" field (already parsed, no currency symbol) and a
separate "price_display" string (human-readable, may contain currency symbols/commas). For
any "price" column, always copy the numeric "price" field's value exactly as given — never
derive it from price_display, never add symbols, commas, or reformat it. If "price" is null
in the raw item, the column value is null too.

Respond with a JSON object in exactly this shape:
{
  "caption": "...",
  "columns": ["col1", "col2", ...],
  "rows": [ {"name": "...", "col1": ..., "col2": ...} ]
}
"rows" must have exactly one entry per input item, in the same order.
"""

_CLASSIFY_SYSTEM = (
    "Classify the search query as exactly one word: 'shopping' if the person wants "
    "to buy/compare a physical product (laptops, phones, shoes, furniture...), or "
    "'other' for anything else (restaurants, courses, services, places, general info). "
    "Respond with only that one word."
)


def _call_with_retry(fn, retries=3, base_delay=1.0):
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            transient = "503" in str(e) or "UNAVAILABLE" in str(e) or "overload" in str(e).lower()
            if attempt == retries - 1 or not transient:
                raise
            time.sleep(base_delay * (2 ** attempt))


def classify_intent(query: str) -> str:
    """Returns 'shopping' or 'other'."""
    response = _call_with_retry(lambda: _client.models.generate_content(
        model=_MODEL,
        contents=query,
        config={
            "system_instruction": _CLASSIFY_SYSTEM,
            "max_output_tokens": 20,
            "thinking_config": {"thinking_budget": 0},  # one-word answer, no reasoning needed
        },
    ))
    label = (response.text or "").strip().lower()
    return "shopping" if "shop" in label else "other"


def infer_and_extract(query: str, items: list[dict]) -> dict:
    if not items:
        return {"caption": "No results found for this query.", "columns": [], "rows": []}

    response = _call_with_retry(lambda: _client.models.generate_content(
        model=_MODEL,
        contents=f"Query: {query}\n\nRaw items:\n{json.dumps(items, indent=2)}",
        config={
            "system_instruction": _EXTRACT_SYSTEM,
            "response_mime_type": "application/json",
            "max_output_tokens": 4096,
            "thinking_config": {"thinking_budget": 0},  # structured extraction, no reasoning needed
        },
    ))

    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, TypeError):
        raise ValueError(f"Gemini did not return parseable JSON:\n{response.text}")

    extracted_rows = parsed.get("rows", [])
    rows = []
    for i, (item, extracted) in enumerate(zip(items, extracted_rows)):
        row = {"id": f"r{i + 1}", **extracted}
        row["source_snippet"] = item.get("snippet")
        rows.append(row)

    return {"caption": parsed.get("caption", ""), "columns": parsed.get("columns", []), "rows": rows}
