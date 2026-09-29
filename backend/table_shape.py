"""Turns an LLM's parsed JSON into a contract-shaped table, without trusting the LLM's
internal consistency. Shared by llm_extract.py and claude_extract.py."""
import logging
import re

log = logging.getLogger(__name__)

# Raw fields we already hold as clean numbers from SerpApi. When a column has one of these
# names (key: column name, value: raw field), the value comes from our own data rather
# than the LLM's copy of it.
_NUMERIC_FIELDS = {"price": "price", "rating": "rating",
                   "reviews": "reviews_count", "reviews_count": "reviews_count"}


def _column_key(name: str) -> str:
    """Consistent lowercase keys whatever casing the LLM used: "Popular For" ->
    "popular_for", "Wi-Fi" -> "wi-fi", "Price for Two" -> "price_for_two"."""
    key = re.sub(r"[^a-z0-9-]+", "_", name.strip().lower())
    return key.strip("_-")


class LLMOutputError(ValueError):
    """The LLM responded, but not with something we can build a table from."""


def _norm(name) -> str:
    return name.strip().casefold() if isinstance(name, str) else ""


def _match_rows(items: list[dict], extracted_rows: list[dict]) -> list:
    """Pairs each input item with its extracted row. Rows whose name equals an item's name
    are matched by name, so a dropped row can't shift everything after it onto the wrong
    item. The model sometimes rewrites names, so whatever is left unmatched on both sides
    is then paired in order. Items still without a row get None (padded with nulls);
    leftover rows are dropped."""
    by_name = {}
    for idx, row in enumerate(extracted_rows):
        by_name.setdefault(_norm(row.get("name")), []).append(idx)

    matched = [None] * len(items)
    used = set()
    for i, item in enumerate(items):
        candidates = by_name.get(_norm(item.get("name")))
        if _norm(item.get("name")) and candidates:
            idx = candidates.pop(0)
            matched[i] = extracted_rows[idx]
            used.add(idx)

    leftover_rows = [row for idx, row in enumerate(extracted_rows) if idx not in used]
    leftover_items = [i for i in range(len(items)) if matched[i] is None]
    for i, row in zip(leftover_items, leftover_rows):
        matched[i] = row

    padded = len(leftover_items) - len(leftover_rows)
    if padded > 0:
        log.warning("LLM returned no row for %d of %d items; padded with nulls", padded, len(items))
    elif padded < 0:
        log.warning("LLM returned %d unmatched extra rows; dropped", -padded)
    if leftover_items and leftover_rows:
        log.warning("%d rows matched by position because their names didn't match any item",
                    min(len(leftover_items), len(leftover_rows)))
    return matched


def build_table(parsed, items: list[dict]) -> dict:
    if not isinstance(parsed, dict):
        raise LLMOutputError(f"expected a JSON object, got {type(parsed).__name__}")

    columns = parsed.get("columns")
    if not isinstance(columns, list):
        columns = []
    # Normalised key -> the name the LLM used. Duplicates, non-strings and our own keys
    # ("id", "source_snippet") are dropped.
    keys = {}
    for c in columns:
        key = _column_key(c) if isinstance(c, str) else ""
        if key and key not in ("id", "source_snippet") and key not in keys:
            keys[key] = c
    columns = list(keys)

    extracted_rows = parsed.get("rows")
    if not isinstance(extracted_rows, list):
        extracted_rows = []
    matched = _match_rows(items, [r for r in extracted_rows if isinstance(r, dict)])

    rows = []
    for i, (item, extracted) in enumerate(zip(items, matched)):
        extracted = extracted or {}
        by_key = {_column_key(k): v for k, v in extracted.items() if isinstance(k, str)}
        row = {"id": f"r{i + 1}", "name": extracted.get("name") or item.get("name")}
        for key, llm_name in keys.items():
            if key == "name":
                continue
            raw = item.get(_NUMERIC_FIELDS[key]) if key in _NUMERIC_FIELDS else None
            row[key] = raw if raw is not None else extracted.get(llm_name, by_key.get(key))
        # source_snippet is always ours; any other key the LLM added is dropped.
        row["source_snippet"] = item.get("snippet")
        rows.append(row)

    # A column most rows can't fill is noise, not a comparison. Drop any column that is
    # empty on more than half the rows.
    sparse = [c for c in columns if c != "name"
              and 2 * sum(r.get(c) not in (None, "", []) for r in rows) < len(rows)]
    if sparse:
        log.warning("Dropping columns filled on fewer than half the rows: %s", sparse)
        columns = [c for c in columns if c not in sparse]
        for r in rows:
            for c in sparse:
                r.pop(c, None)

    return {"caption": _caption(columns), "columns": columns, "rows": rows}


def _caption(columns: list[str]) -> str:
    """Built from the columns that survived the guardrail, so the caption can never
    mention one the table doesn't have."""
    names = [c.replace("_", " ") for c in columns if c != "name"]
    if not names:
        return "None of the attributes were available for enough of these results to compare."
    if len(names) == 1:
        return f"Comparing by {names[0]}."
    return f"Comparing by {', '.join(names[:-1])} and {names[-1]}."
