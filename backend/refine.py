import json
import logging
import os
import re
import time
from typing import Annotated, Any
from pydantic import BaseModel, StringConstraints

log = logging.getLogger("uvicorn.error")

_MODEL_GEMINI = "gemini-3.1-flash-lite"
_MODEL_CLAUDE = "claude-haiku-4-5-20251001"


class RefineRequest(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    rows: list[dict[str, Any]]
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return m.group(1) if m else text


def _extract_columns(rows: list[dict]) -> list[str]:
    """Derives comparison columns from rows, preserving order and excluding metadata."""
    if not rows:
        return []
    columns = []
    for r in rows:
        for k in r.keys():
            if k not in ("id", "name", "source_snippet") and k not in columns:
                columns.append(k)
    return columns


def _refine_heuristic(query: str, rows: list[dict], instruction: str) -> dict:
    """Fallback filter & sort logic when LLM is unavailable or offline."""
    instruction_lower = instruction.lower().strip()
    kept = list(rows)
    caption_parts = []

    # Filter: under / below / less than / <= / <
    under_match = re.search(r"(?:under|below|less than|<|<=)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:[.,]\d+)?)\s*(k|lakh|lac|m)?", instruction_lower)
    if under_match:
        val = float(under_match.group(1).replace(",", ""))
        unit = (under_match.group(2) or "").lower()
        if unit == "k":
            val *= 1000
        elif unit in ("lakh", "lac"):
            val *= 100000
        elif val < 500 and "under" in instruction_lower:
            val *= 1000  # "under 50" often means 50k
        
        filtered = []
        for r in kept:
            p = r.get("price")
            if p is not None:
                try:
                    num_p = float(str(p).replace(",", "").replace("₹", "").strip())
                    if num_p <= val:
                        filtered.append(r)
                except ValueError:
                    pass
        if filtered:
            kept = filtered
            caption_parts.append(f"under ₹{int(val):,}")

    # Filter: over / above / more than / > / >=
    over_match = re.search(r"(?:over|above|more than|>|>=)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:[.,]\d+)?)\s*(k|lakh|lac|m)?", instruction_lower)
    if over_match:
        val = float(over_match.group(1).replace(",", ""))
        unit = (over_match.group(2) or "").lower()
        if unit == "k":
            val *= 1000
        elif unit in ("lakh", "lac"):
            val *= 100000
        filtered = []
        for r in kept:
            p = r.get("price")
            if p is not None:
                try:
                    num_p = float(str(p).replace(",", "").replace("₹", "").strip())
                    if num_p >= val:
                        filtered.append(r)
                except ValueError:
                    pass
        if filtered:
            kept = filtered
            caption_parts.append(f"over ₹{int(val):,}")

    # Filter: price_level symbol tier (e.g. "$$", "$$$", "under $$")
    tier_match = re.search(r"(?:under|below|less than|only|show)?\s*(\${1,4})", instruction_lower)
    if tier_match:
        target_tier = tier_match.group(1)
        max_symbols = len(target_tier)
        filtered = []
        for r in kept:
            for k, v in r.items():
                if isinstance(v, str) and re.fullmatch(r"\${1,4}", v.strip()):
                    if len(v.strip()) <= max_symbols:
                        filtered.append(r)
                        break
        if filtered:
            kept = filtered
            caption_parts.append(f"price level {target_tier} or less")

    # Exclude: exclude / without / no / remove
    exclude_match = re.search(r"(?:exclude|without|no|remove)\s+([a-z0-9]+)", instruction_lower)
    if exclude_match:
        target = exclude_match.group(1).lower()
        filtered = [r for r in kept if target not in str(r.get("name", "")).lower()]
        if filtered:
            kept = filtered
            caption_parts.append(f"excluding {target}")

    # Sort: price / rating / battery
    if "cheapest" in instruction_lower or "price low" in instruction_lower or "lowest price" in instruction_lower:
        kept.sort(key=lambda r: float(r.get("price") or float("inf")))
        caption_parts.append("sorted by price: low to high")
    elif "highest price" in instruction_lower or "expensive" in instruction_lower:
        kept.sort(key=lambda r: float(r.get("price") or float("-inf")), reverse=True)
        caption_parts.append("sorted by price: high to low")
    elif "rating" in instruction_lower or "top rated" in instruction_lower or "best rated" in instruction_lower:
        kept.sort(key=lambda r: float(r.get("rating") or 0), reverse=True)
        caption_parts.append("sorted by rating")

    # Keyword filter if no numeric filters matched
    if not under_match and not over_match and not exclude_match and len(kept) == len(rows):
        words = [w for w in re.findall(r"[a-z0-9]+", instruction_lower) if w not in ("show", "only", "the", "with", "for", "me", "find", "all", "sort", "by")]
        if words:
            matching = []
            for r in kept:
                row_text = (str(r.get("name", "")) + " " + " ".join(str(v) for v in r.values())).lower()
                if any(w in row_text for w in words):
                    matching.append(r)
            if matching:
                kept = matching
                caption_parts.append(f"matching '{instruction}'")

    if not caption_parts:
        caption = f"Refined results for '{instruction}' ({len(kept)} items)"
    else:
        caption = f"Refined to items {', '.join(caption_parts)} ({len(kept)} items)"

    return {
        "caption": caption,
        "columns": _extract_columns(rows),
        "rows": kept,
    }


def _refine_with_gemini(query: str, rows: list[dict], instruction: str, api_key: str) -> dict:
    from google import genai
    client = genai.Client(api_key=api_key)

    # Prepare compact rows for LLM prompt (omit long snippets to conserve tokens)
    compact_rows = []
    for r in rows:
        c = {k: v for k, v in r.items() if k != "source_snippet"}
        compact_rows.append(c)

    prompt = f"""User original search query: "{query}"

Current comparison items:
{json.dumps(compact_rows, indent=2)}

User refinement instruction: "{instruction}"

You must:
1. Interpret the user's instruction and decide which items to KEEP and in what ORDER.
   - For filtering (e.g. "only show under 50k", "must have 16GB", "exclude Lenovo"): keep only rows that qualify.
   - For sorting (e.g. "sort by rating descending", "cheapest first"): order the kept items accordingly.
   - If no items qualify, return an empty array for row_ids.
   - Note: Some queries return non-numeric columns like price_level ($ or $$) or tags. Handle them naturally by type without assuming all columns are numeric.
2. CRITICAL CONSTRAINTS:
   - ONLY select from the provided row IDs.
   - NEVER invent a new item or modify any existing values.
3. Write one short, natural caption explaining what is now being shown (e.g. "Filtered to laptops under ₹50,000, sorted by price" or "Filtered to budget-friendly options ($$)").

Respond with ONLY a JSON object:
{{
  "caption": "one descriptive caption sentence",
  "row_ids": ["r1", "r2", ...]
}}
"""
    system_prompt = "You are a precise comparison table refinement assistant. You filter, reorder, and rank existing items according to instructions without hallucinating or modifying values. You handle both numeric and non-numeric columns (like price_level '$$') appropriately."

    response = client.models.generate_content(
        model=_MODEL_GEMINI,
        contents=prompt,
        config={
            "system_instruction": system_prompt,
            "response_mime_type": "application/json",
            "max_output_tokens": 1024,
            "thinking_config": {"thinking_budget": 0},
            "http_options": {"timeout": 15_000},
        },
    )

    parsed = json.loads(response.text)
    caption = parsed.get("caption") or f"Refined for '{instruction}'"
    row_ids = parsed.get("row_ids") or []

    # Reconstruct selected rows from original rows strictly by ID
    row_map = {str(r.get("id")): r for r in rows}
    refined_rows = []
    seen = set()
    for rid in row_ids:
        rid_str = str(rid)
        if rid_str in row_map and rid_str not in seen:
            refined_rows.append(row_map[rid_str])
            seen.add(rid_str)

    # Fallback if row_ids failed to match but rows were returned directly
    if not refined_rows and isinstance(parsed.get("rows"), list):
        for candidate in parsed["rows"]:
            cid = str(candidate.get("id"))
            cname = str(candidate.get("name", "")).strip().lower()
            if cid in row_map and cid not in seen:
                refined_rows.append(row_map[cid])
                seen.add(cid)
            else:
                for r in rows:
                    if r.get("id") not in seen and str(r.get("name", "")).strip().lower() == cname:
                        refined_rows.append(r)
                        seen.add(r.get("id"))
                        break

    return {
        "caption": caption,
        "columns": _extract_columns(rows),
        "rows": refined_rows,
    }


def _refine_with_claude(query: str, rows: list[dict], instruction: str, api_key: str) -> dict:
    from anthropic import Anthropic
    client = Anthropic(api_key=api_key, timeout=20.0, max_retries=1)

    compact_rows = []
    for r in rows:
        c = {k: v for k, v in r.items() if k != "source_snippet"}
        compact_rows.append(c)

    prompt = f"""User original search query: "{query}"

Current comparison items:
{json.dumps(compact_rows, indent=2)}

User refinement instruction: "{instruction}"

Respond with ONLY a JSON object:
{{
  "caption": "one descriptive caption sentence",
  "row_ids": ["r1", "r2", ...]
}}
"""
    system_prompt = (
        "You are a comparison table refinement assistant. Filter, reorder, or rank the existing items "
        "based on the user's instruction. Select ONLY from the provided row IDs. Do not invent items or alter values. "
        "Write one concise caption explaining the refinement."
    )

    message = client.messages.create(
        model=_MODEL_CLAUDE,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
    cleaned = _strip_code_fence(raw_text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        parsed = json.loads(m.group(0)) if m else {}

    caption = parsed.get("caption") or f"Refined for '{instruction}'"
    row_ids = parsed.get("row_ids") or []

    row_map = {str(r.get("id")): r for r in rows}
    refined_rows = []
    seen = set()
    for rid in row_ids:
        rid_str = str(rid)
        if rid_str in row_map and rid_str not in seen:
            refined_rows.append(row_map[rid_str])
            seen.add(rid_str)

    return {
        "caption": caption,
        "columns": _extract_columns(rows),
        "rows": refined_rows,
    }


def do_refine(query: str, rows: list[dict], instruction: str) -> dict:
    """Refines comparison rows based on instruction. Preserves row identity and contract shape."""
    if not rows:
        return {"caption": "No items to refine.", "columns": [], "rows": []}

    gemini_key = os.getenv("GEMINI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    # Prefer Gemini if key present (matches backend/main.py default)
    if gemini_key:
        try:
            return _refine_with_gemini(query, rows, instruction, gemini_key)
        except Exception as e:
            log.warning("Gemini refine failed: %s; trying fallback", e)

    # Try Anthropic Claude if key present
    if anthropic_key:
        try:
            return _refine_with_claude(query, rows, instruction, anthropic_key)
        except Exception as e:
            log.warning("Claude refine failed: %s; trying fallback", e)

    # Heuristic fallback if no LLM key or LLM call failed
    log.info("Applying heuristic refinement for instruction: %s", instruction)
    return _refine_heuristic(query, rows, instruction)
