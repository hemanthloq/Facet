import os
import re
import time
import unicodedata

import requests

from llm_extract import classify_intent

SERPAPI_BASE = "https://serpapi.com/search"
_TIMEOUT = 10  # seconds per attempt; a normal SerpApi response takes 2-5s
_RETRIES = 2   # extra attempts after a timeout, connection error or 5xx
_MAX_ITEMS = 10


def _get(params: dict) -> dict:
    params = {**params, "api_key": os.environ["SERPAPI_API_KEY"]}
    for attempt in range(_RETRIES + 1):
        try:
            resp = requests.get(SERPAPI_BASE, params=params, timeout=_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as e:
            server_error = isinstance(e, requests.HTTPError) and e.response is not None \
                and e.response.status_code >= 500
            if attempt == _RETRIES or (isinstance(e, requests.HTTPError) and not server_error):
                raise
            time.sleep(0.5 * 2 ** attempt)


_CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]")


def _clean(value):
    """Normalises text from SerpApi: NFC form, no control or replacement characters,
    collapsed whitespace. Legitimate characters like ₹ or ” are kept."""
    if isinstance(value, str):
        value = _CONTROL.sub("", unicodedata.normalize("NFC", value))
        return re.sub(r"\s+", " ", value).strip() or None
    if isinstance(value, list):
        return [v for v in (_clean(v) for v in value) if v is not None]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def search_shopping(query: str) -> list[dict]:
    data = _get({"engine": "google_shopping", "q": query, "gl": "in", "hl": "en"})
    items = []
    for r in data.get("shopping_results", []):
        items.append({
            "name": r.get("title"),
            "price": r.get("extracted_price"),
            "price_display": r.get("price"),
            "rating": r.get("rating"),
            "reviews_count": r.get("reviews"),
            "seller": r.get("source"),
            "link": r.get("product_link") or r.get("link"),
            "thumbnail": r.get("thumbnail"),
            "snippet": None,  # Shopping results don't carry review text
        })
    return items


def search_places(query: str) -> list[dict]:
    """Google Maps results: consistent structured facts for venues and local businesses."""
    data = _get({"engine": "google_maps", "type": "search", "q": query, "gl": "in", "hl": "en"})
    results = data.get("local_results") or []
    if not results and isinstance(data.get("place_results"), dict):
        results = [data["place_results"]]  # the query named one specific place
    items = []
    for r in results:
        features = {}
        for group in r.get("extensions") or []:
            if isinstance(group, dict):
                for key, values in group.items():
                    if isinstance(values, list):
                        features[key] = values[:8]
        review = r.get("user_review")
        items.append({
            "name": r.get("title"),
            "price": None,  # Maps gives a range, not one number; see price_range
            "price_range": r.get("price"),
            "rating": r.get("rating"),
            "reviews_count": r.get("reviews"),
            "category": r.get("type"),
            "address": r.get("address"),
            "open_state": r.get("open_state"),
            "features": features,
            "link": r.get("website"),
            "thumbnail": r.get("thumbnail"),
            # Review text for /insight when Maps has one, else the business description
            "snippet": review.strip('"') if isinstance(review, str) else r.get("description"),
        })
    return items


def search_general(query: str) -> list[dict]:
    """Last resort: general Google search for queries that are neither products nor places."""
    data = _get({"engine": "google", "q": query, "gl": "in", "hl": "en"})
    items = []
    for r in data.get("organic_results", []):
        rich = r.get("rich_snippet", {}) or {}
        rating = (
            rich.get("top", {}).get("detected_extensions", {}).get("rating")
            if isinstance(rich.get("top"), dict) else None
        )
        items.append({
            "name": r.get("title"),
            "price": None,
            "price_display": None,
            "rating": rating,
            "reviews_count": None,
            "source": r.get("source"),  # the website, e.g. "Reddit" or "GoSkills" — not a seller
            "link": r.get("link"),
            "thumbnail": r.get("thumbnail"),
            "snippet": r.get("snippet"),  # real text — the one path with genuine content
        })
    return items


def _phrases(*words: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(words) + r")\b")


_SHOP_WORDS = _phrases(
    r"buy", r"price", r"prices", r"cheap", r"cheapest", r"deals?", r"discount", r"under \d[\d,]*k?",
    r"below \d[\d,]*k?", r"\d+k", r"rs\.?", r"rupees", r"laptops?", r"phones?", r"smartphones?",
    r"mobiles?", r"iphones?", r"tablets?", r"headphones?", r"earphones?", r"earbuds", r"tvs?",
    r"televisions?", r"monitors?", r"cameras?", r"smartwatch(?:es)?", r"watch(?:es)?", r"shoes",
    r"sneakers", r"backpacks?", r"keyboards?", r"mouse", r"speakers?", r"refrigerators?", r"fridges?",
    r"washing machines?", r"air conditioners?", r"mattress(?:es)?", r"printers?", r"routers?",
    r"ssds?", r"gpus?", r"graphics cards?", r"acer", r"asus", r"dell", r"hp", r"lenovo", r"apple",
    r"samsung", r"oneplus", r"xiaomi", r"redmi", r"realme", r"oppo", r"vivo", r"sony", r"lg",
    r"boat", r"nike", r"adidas", r"puma",
)
_PLACE_WORDS = _phrases(
    r"near me", r"nearby", r"near", r"cafes?", r"café", r"cafés", r"coffee shops?", r"restaurants?",
    r"bars?", r"pubs?", r"bakery", r"bakeries", r"salons?", r"spas?", r"gyms?", r"hotels?",
    r"hostels?", r"resorts?", r"clinics?", r"hospitals?", r"dentists?", r"pharmac(?:y|ies)",
    r"parks?", r"museums?", r"malls?", r"theatres?", r"cinemas?", r"libraries", r"library",
    r"coworking(?: spaces?)?", r"places to", r"where to eat", r"dhabas?", r"street food",
)


def classify_query(query: str) -> str:
    """'shopping', 'place' or 'other'. Keyword signals settle clear cases for free; when
    they're absent or conflicting (e.g. "buy coffee beans at a cafe"), an LLM decides."""
    q = query.lower()
    shop, place = bool(_SHOP_WORDS.search(q)), bool(_PLACE_WORDS.search(q))
    if shop != place:
        return "shopping" if shop else "place"
    return classify_intent(query)


def search(query: str) -> tuple[list[dict], str]:
    """Returns (items, engine_used). Falls back to general search when the chosen
    engine returns nothing."""
    kind = classify_query(query)
    if kind == "shopping":
        items, engine = search_shopping(query), "google_shopping"
    elif kind == "place":
        items, engine = search_places(query), "google_maps"
    else:
        items, engine = [], "google"
    if not items:
        items, engine = search_general(query), "google"
    return [_clean(item) for item in items[:_MAX_ITEMS]], engine
