import os
import requests

from llm_extract import classify_intent

SERPAPI_BASE = "https://serpapi.com/search"


def _get(params: dict) -> dict:
    params = {**params, "api_key": os.environ["SERPAPI_API_KEY"]}
    resp = requests.get(SERPAPI_BASE, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def search_shopping(query: str) -> list[dict]:
    """Try Google Shopping first. Returns [] if nothing usable came back."""
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


def search_general(query: str) -> list[dict]:
    """Fallback: general Google search — restaurants, courses, anything non-shopping."""
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
            "seller": r.get("source"),
            "link": r.get("link"),
            "thumbnail": r.get("thumbnail"),
            "snippet": r.get("snippet"),  # real text — the one path with genuine content
        })
    return items


def search(query: str) -> tuple[list[dict], str]:
    """Returns (items, engine_used). Routes by classified intent, not by whether
    Shopping happened to return *something* — it almost always does."""
    if classify_intent(query) == "shopping":
        items = search_shopping(query)
        if items:
            return items[:10], "google_shopping"
    return search_general(query)[:10], "google"
