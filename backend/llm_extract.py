import json
import os
import time

from dotenv import load_dotenv
load_dotenv()

from google import genai

from query_focus import EXTRACT_RULES, extract_prompt
from table_shape import LLMOutputError, build_table

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
_MODEL = "gemini-3.1-flash-lite"  # gemini-3.8-flash hit its 20-req/day free-tier cap during testing
# The SDK's default is no timeout at all, so a hung request would block /search forever.
_CLASSIFY_TIMEOUT_MS = 10_000
_EXTRACT_TIMEOUT_MS = 30_000


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
            transient = "503" in str(e) or "UNAVAILABLE" in str(e) or "overload" in str(e).lower()
            if attempt == retries - 1 or not transient:
                raise
            time.sleep(base_delay * (2 ** attempt))


def classify_intent(query: str) -> str:
    """Returns 'shopping', 'place' or 'other'."""
    response = _call_with_retry(lambda: _client.models.generate_content(
        model=_MODEL,
        contents=query,
        config={
            "system_instruction": _CLASSIFY_SYSTEM,
            "max_output_tokens": 20,
            "thinking_config": {"thinking_budget": 0},  # one-word answer, no reasoning needed
            "http_options": {"timeout": _CLASSIFY_TIMEOUT_MS},
        },
    ))
    return _parse_label(response.text)


def _parse_label(text) -> str:
    label = (text or "").strip().lower()
    if "place" in label:
        return "place"
    return "shopping" if "shop" in label else "other"


def infer_and_extract(query: str, items: list[dict]) -> dict:
    if not items:
        return {"caption": "No results found for this query.", "columns": [], "rows": []}

    response = _call_with_retry(lambda: _client.models.generate_content(
        model=_MODEL,
        contents=extract_prompt(query, items),
        config={
            "system_instruction": EXTRACT_RULES,
            "response_mime_type": "application/json",
            "max_output_tokens": 4096,
            "thinking_config": {"thinking_budget": 0},  # structured extraction, no reasoning needed
            "http_options": {"timeout": _EXTRACT_TIMEOUT_MS},
        },
    ))

    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, TypeError):
        raise LLMOutputError(f"Gemini did not return parseable JSON:\n{response.text}")

    return build_table(parsed, items)
