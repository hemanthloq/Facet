"""Finds what a query is specifically asking for ("for studying", "with good battery",
"budget") so column selection can answer it instead of defaulting to rating/price.
Shared by llm_extract.py and claude_extract.py."""
import json
import re

# "for studying", "with good battery", "under 60000" — up to the next connector or the end
_PHRASE = re.compile(
    r"\b(?:for|with|without|under|below|within)\s+(?:a |an |the )?"
    r"([^,]+?)(?=\s+(?:for|with|without|under|below|within|in|near|at|and|or)\b|$)"
)
_ADJECTIVES = re.compile(
    r"\b(?:budget|cheap|cheapest|affordable|premium|luxury|quiet|peaceful|cozy|cosy|romantic|"
    r"rooftop|spacious|family[- ]friendly|kid[- ]friendly|pet[- ]friendly|vegan|vegetarian|veg|"
    r"beginners?|advanced|intermediate|free|online|offline|certified|lightweight|portable|"
    r"compact|wireless|waterproof|open late|24/7|late night|healthy|authentic|student)\b"
)


def query_focus(query: str) -> list[str]:
    q = query.lower().strip()
    found = [m.group(0).strip() for m in _PHRASE.finditer(q)]
    found += [m.group(0) for m in _ADJECTIVES.finditer(q)
              if not any(m.group(0) in phrase for phrase in found)]
    return list(dict.fromkeys(found))


EXTRACT_RULES = """You turn raw search results into a structured comparison table.

Given a user's query, its focus (the qualifying terms that say what the user cares about),
and a list of raw result items:

1. Choose 3-5 columns that are worth comparing for THIS question.
   - For each focus term, include a column that answers it IF a raw field states the answer:
     "features" groups (amenities, atmosphere, popular_for, ...), specs written in the
     product name, "price_range", or snippet text. For example, a focus of "for studying"
     on cafes is answered by Wi-Fi, quiet atmosphere or "good for working on laptop", not
     by rating.
   - Rule 3 always wins over this one. If no raw field states something that answers a
     focus term, skip that focus term: don't create a column for it. Never make a yes/no
     or rating-style column from your own judgement of an item (e.g. "beginner level: Yes"
     because a course looks introductory); only use a value the raw data states.
   - Fill the remaining slots with general attributes (rating, price, reviews) only if they
     help; use them as the main columns only when there is no focus or no field answers it.
   - Only propose a column if at least half of the items have a value for it in the raw
     data; a column that is null for most rows will be discarded.
2. Name each column for what it means in this query's domain, not after the raw field it
   came from: a course's website is its "provider" or "platform", a cafe's "type" is its
   "category". Use "seller" only for products bought from a store. Keep names short.
3. Extract values using ONLY what's in the raw data. If an item doesn't have the attribute,
   or the raw data doesn't state it, use null. NEVER invent, infer or estimate a value,
   even when it seems likely. For a column built from
   "features", the value is the matching feature text (e.g. "Free Wi-Fi", "Quiet"), or null
   when that item doesn't list it.
4. Raw items include a numeric "price" field (already parsed) and may include a
   "price_display" string with currency symbols. For any "price" column, copy the numeric
   "price" field exactly — never derive it from price_display. If "price" is null, the
   value is null.
5. Any value that is a plain quantity with no unit (a price, a count, a rating) must be a
   JSON number, not a string — 550, not "550". Keep a string when the unit is part of the
   value (e.g. "16GB", "18 hrs").
6. Every row must contain a key for every name in "columns", spelled exactly the same.

Respond with a JSON object in exactly this shape:
{
  "columns": ["col1", "col2", ...],
  "rows": [ {"name": "...", "col1": ..., "col2": ...} ]
}
"rows" must have exactly one entry per input item, in the same order.
"""


def extract_prompt(query: str, items: list[dict]) -> str:
    focus = query_focus(query)
    return (f"Query: {query}\n"
            f"Focus: {', '.join(focus) if focus else 'none'}\n\n"
            f"Raw items:\n{json.dumps(items, indent=2, ensure_ascii=False)}")
