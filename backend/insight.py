import json
import logging
import os
import re
from typing import Any
from pydantic import BaseModel

log = logging.getLogger("uvicorn.error")

_MODEL_GEMINI = "gemini-3.1-flash-lite"
_MODEL_CLAUDE = "claude-haiku-4-5-20251001"


class InsightRequest(BaseModel):
    row: dict[str, Any]


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return m.group(1) if m else text


def _insight_heuristic(row: dict, snippet: str) -> dict:
    """Extracts genuine pros/cons from text when LLM key is absent or offline."""
    pros = []
    cons = []
    flag = None

    sentences = [s.strip() for s in re.split(r"[.!?;\n]+", snippet) if len(s.strip()) > 8]

    # Look for positive sentiment signals in sentences
    pos_words = ("great", "excellent", "good", "fast", "powerful", "lightweight", "best", "sharp", "long battery", "smooth")
    neg_words = ("poor", "bad", "slow", "heavy", "tinny", "heating", "short battery", "dim", "noisy", "disappointing")
    flag_words = ("issue", "defect", "fail", "degrade", "overheat", "glitch", "crash", "drain", "broken", "complaint")

    for s in sentences:
        s_lower = s.lower()
        if any(w in s_lower for w in flag_words) and not flag:
            flag = s
        elif any(w in s_lower for w in pos_words) and len(pros) < 2:
            pros.append(s)
        elif any(w in s_lower for w in neg_words) and len(cons) < 2:
            cons.append(s)

    if not pros and sentences:
        pros.append(sentences[0])

    return {
        "pros": pros,
        "cons": cons,
        "flag": flag,
    }


def _insight_with_gemini(row: dict, snippet: str, api_key: str) -> dict:
    from google import genai
    client = genai.Client(api_key=api_key)

    name = row.get("name", "Item")
    prompt = f"""You are analyzing search snippet text for an item to give an honest, grounded review breakdown.

Item name: {name}
Search snippet text:
\"\"\"{snippet}\"\"\"

Instructions:
1. "pros": Array of up to 2 distinct genuine positive attributes mentioned in the snippet. (Short phrases).
2. "cons": Array of up to 2 distinct drawbacks or limitations mentioned in the snippet. (Short phrases).
3. "flag": ONE specific recurring warning or red flag ONLY IF explicitly supported by the snippet text. Otherwise null.
4. STRICT RULE: Read ONLY what the text says. NEVER hallucinate or invent specs/reviews not in this snippet.

Respond with ONLY a JSON object:
{{
  "pros": ["..."],
  "cons": ["..."],
  "flag": "..." or null
}}
"""
    response = client.models.generate_content(
        model=_MODEL_GEMINI,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "max_output_tokens": 512,
            "thinking_config": {"thinking_budget": 0},
            "http_options": {"timeout": 15_000},
        },
    )

    parsed = json.loads(response.text)
    pros = [str(p) for p in parsed.get("pros", []) if isinstance(p, str)]
    cons = [str(c) for c in parsed.get("cons", []) if isinstance(c, str)]
    flag = parsed.get("flag")
    if flag is not None and not isinstance(flag, str):
        flag = str(flag)

    return {
        "pros": pros[:2],
        "cons": cons[:2],
        "flag": flag,
    }


def _insight_with_claude(row: dict, snippet: str, api_key: str) -> dict:
    from anthropic import Anthropic
    client = Anthropic(api_key=api_key, timeout=15.0, max_retries=1)

    name = row.get("name", "Item")
    prompt = f"""Analyze this snippet text for {name}:
\"\"\"{snippet}\"\"\"

Extract:
1. pros: Up to 2 positive points in text.
2. cons: Up to 2 negative points in text.
3. flag: 1 red flag sentence ONLY if supported by text, else null.

Respond with ONLY JSON:
{{
  "pros": [...],
  "cons": [...],
  "flag": null or "..."
}}
"""
    message = client.messages.create(
        model=_MODEL_CLAUDE,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
    cleaned = _strip_code_fence(raw_text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        parsed = json.loads(m.group(0)) if m else {}

    pros = [str(p) for p in parsed.get("pros", []) if isinstance(p, str)]
    cons = [str(c) for c in parsed.get("cons", []) if isinstance(c, str)]
    flag = parsed.get("flag")
    if flag is not None and not isinstance(flag, str):
        flag = str(flag)

    return {
        "pros": pros[:2],
        "cons": cons[:2],
        "flag": flag,
    }


def do_insight(row: dict) -> dict:
    """Generates pros, cons, and optional red flag from row['source_snippet'].
    Honest limits: If source_snippet is missing, returns empty pros/cons and null flag."""
    if not isinstance(row, dict):
        return {"pros": [], "cons": [], "flag": None, "note": "Invalid row object."}

    snippet = row.get("source_snippet")
    if not snippet or not isinstance(snippet, str) or len(snippet.strip()) < 8:
        return {
            "pros": [],
            "cons": [],
            "flag": None,
            "note": "No review snippet was returned in the search results for this item.",
        }

    gemini_key = os.getenv("GEMINI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    if gemini_key:
        try:
            return _insight_with_gemini(row, snippet.strip(), gemini_key)
        except Exception as e:
            log.warning("Gemini insight failed: %s; trying fallback", e)

    if anthropic_key:
        try:
            return _insight_with_claude(row, snippet.strip(), anthropic_key)
        except Exception as e:
            log.warning("Claude insight failed: %s; trying fallback", e)

    return _insight_heuristic(row, snippet.strip())
