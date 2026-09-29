import json
import os
import re
import time

from dotenv import load_dotenv
load_dotenv()

from anthropic import Anthropic

from query_focus import EXTRACT_RULES, extract_prompt
from table_shape import LLMOutputError, build_table

# SDK defaults are a 600s timeout and 2 retries of its own; _call_with_retry already retries,
# so the SDK's are turned off rather than multiplying (3 x 3 attempts).
_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=30.0, max_retries=0)
_CLASSIFY_MODEL = "claude-haiku-4-5-20251001"
_EXTRACT_MODEL = "claude-sonnet-5"

_EXTRACT_SYSTEM = EXTRACT_RULES + "\nRespond with ONLY the JSON object: no prose, no markdown code fences.\n"

_CLASSIFY_SYSTEM = (
    "Classify the search query as exactly one word: 'shopping' if the person wants "
    "to buy/compare a physical product (laptops, phones, shoes, furniture...); 'place' "
    "if they want to find/compare physical venues or local businesses to visit (cafes, "
    "restaurants, gyms, salons, clinics, hotels, stores as places); or 'other' for "
    "anything else (courses, services, software, general info). "
    "Respond with only that one word."
)


def _call_with_retry(fn, retries=3, base_delay=1.0):
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            transient = any(s in str(e) for s in ("503", "504", "529", "overloaded", "rate_limit", "429"))
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
    """Returns 'shopping', 'place' or 'other'."""
    message = _call_with_retry(lambda: _client.messages.create(
        model=_CLASSIFY_MODEL,
        max_tokens=5,
        system=_CLASSIFY_SYSTEM,
        messages=[{"role": "user", "content": query}],
        timeout=10.0,
    ))
    label = _text_of(message).strip().lower()
    if "place" in label:
        return "place"
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
            "content": extract_prompt(query, items),
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
