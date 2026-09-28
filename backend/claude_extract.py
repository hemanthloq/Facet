import json
import os
import re
import time

from dotenv import load_dotenv
load_dotenv()

from anthropic import Anthropic

from table_shape import LLMOutputError, build_table

# SDK defaults are a 600s timeout and 2 retries of its own; _call_with_retry already retries,
# so the SDK's are turned off rather than multiplying (3 x 3 attempts).
_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=30.0, max_retries=0)
_CLASSIFY_MODEL = "claude-haiku-4-5-20251001"
_EXTRACT_MODEL = "claude-sonnet-5"

_EXTRACT_SYSTEM = """You turn raw search results into a structured comparison table.

Given a user's query and a list of raw result items, you must:
1. Infer 3-5 column attributes that actually matter for comparing THIS kind of thing
   (laptops get RAM/battery/price; restaurants get cuisine/price-range/rating; courses
   get duration/price/level). Do not default to laptop-shaped columns for non-laptop queries.
2. For each item, extract values using ONLY what's in the raw data given to you. If an
   attribute genuinely isn't present for an item, set it to null. NEVER invent or estimate
   a plausible-looking value.
3. Raw items include both a numeric "price" field (already parsed, no currency symbol) and
   a separate "price_display" string (human-readable, may contain currency symbols/commas).
   For any "price" column, always copy the numeric "price" field's value exactly as given —
   never derive it from price_display, never add symbols, commas, or reformat it. If "price"
   is null in the raw item, the column value is null too.
4. Any value that is a plain quantity with no unit (a price, a count, a rating) must be a
   JSON number, not a string — 550, not "550". Keep a string only when the unit is part of
   the value (e.g. "16GB", "18 hrs").
5. Every row must contain a key for every name in "columns", spelled exactly the same.
6. Write one short caption sentence explaining what you're comparing by and why.

Respond with ONLY a JSON object, no prose, no markdown code fences, in exactly this shape:
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
            transient = any(s in str(e) for s in ("503", "529", "overloaded", "rate_limit", "429"))
            if attempt == retries - 1 or not transient:
                raise
            time.sleep(base_delay * (2 ** attempt))


def _text_of(message) -> str:
    return "".join(b.text for b in message.content if getattr(b, "type", None) == "text")


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return m.group(1) if m else text


def classify_intent(query: str) -> str:
    """Returns 'shopping' or 'other'."""
    message = _call_with_retry(lambda: _client.messages.create(
        model=_CLASSIFY_MODEL,
        max_tokens=5,
        system=_CLASSIFY_SYSTEM,
        messages=[{"role": "user", "content": query}],
        timeout=10.0,
    ))
    label = _text_of(message).strip().lower()
    return "shopping" if "shop" in label else "other"


def infer_and_extract(query: str, items: list[dict]) -> dict:
    if not items:
        return {"caption": "No results found for this query.", "columns": [], "rows": []}

    message = _call_with_retry(lambda: _client.messages.create(
        model=_EXTRACT_MODEL,
        max_tokens=4096,
        system=_EXTRACT_SYSTEM,
        messages=[{
            "role": "user",
            "content": f"Query: {query}\n\nRaw items:\n{json.dumps(items, indent=2)}",
        }],
    ))

    raw_text = _text_of(message)
    cleaned = _strip_code_fence(raw_text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        try:
            parsed = json.loads(m.group(0)) if m else None
        except json.JSONDecodeError:
            parsed = None
        if parsed is None:
            raise LLMOutputError(f"Claude did not return parseable JSON:\n{raw_text}")

    return build_table(parsed, items)
