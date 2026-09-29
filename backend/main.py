from dotenv import load_dotenv
load_dotenv()

import logging
import re
from typing import Annotated

import httpx
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from serp_client import search
from llm_extract import infer_and_extract
from table_shape import LLMOutputError
from refine import do_refine, RefineRequest
from insight import do_insight, InsightRequest

log = logging.getLogger("uvicorn.error")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class SearchRequest(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


def _upstream_status(e: Exception):
    # google-genai errors carry .code, anthropic errors carry .status_code
    return getattr(e, "status_code", None) or getattr(e, "code", None)


# Errors are caught here rather than in an app-level exception handler: Starlette's
# catch-all 500 handler sits outside CORSMiddleware, so its responses carry no CORS
# headers and a browser reports them as a CORS failure instead of a server error.
@app.post("/search")
def do_search(req: SearchRequest):
    try:
        items, _ = search(req.query)
        return infer_and_extract(req.query, items)
    except requests.RequestException as e:
        # str(e) includes the request URL, which carries the SerpApi key
        log.error("SerpApi call failed: %s", re.sub(r"api_key=[^&\s]+", "api_key=***", str(e)))
        return _error(502, "search_unavailable", "The search provider didn't respond. Please try again.")
    except LLMOutputError:
        log.exception("LLM returned unusable output")
        return _error(502, "ai_bad_output", "The AI returned a response we couldn't read. Please try again.")
    except Exception as e:
        log.exception("/search failed")
        if isinstance(e, httpx.TimeoutException) or _upstream_status(e) in (429, 503, 504, 529) \
                or type(e).__name__ in ("APITimeoutError", "RateLimitError", "OverloadedError"):
            return _error(503, "ai_busy", "The AI service is busy or rate-limited. Please try again shortly.")
        if type(e).__module__.startswith(("google.genai", "anthropic", "httpx")):
            return _error(502, "ai_unavailable", "The AI service returned an error.")
        return _error(500, "internal_error", "Something went wrong on our side.")


@app.post("/refine")
def refine_comparison(req: RefineRequest):
    try:
        return do_refine(req.query, req.rows, req.instruction)
    except Exception as e:
        log.exception("/refine failed")
        if isinstance(e, httpx.TimeoutException) or _upstream_status(e) in (429, 503, 529):
            return _error(503, "ai_busy", "The AI service is busy or rate-limited. Please try again shortly.")
        if type(e).__module__.startswith(("google.genai", "anthropic", "httpx")):
            return _error(502, "ai_unavailable", "The AI service returned an error.")
        return _error(500, "internal_error", "Something went wrong refining the comparison.")


@app.post("/insight")
def get_row_insight(req: InsightRequest):
    try:
        return do_insight(req.row)
    except Exception as e:
        log.exception("/insight failed")
        if isinstance(e, httpx.TimeoutException) or _upstream_status(e) in (429, 503, 529):
            return _error(503, "ai_busy", "The AI service is busy or rate-limited. Please try again shortly.")
        if type(e).__module__.startswith(("google.genai", "anthropic", "httpx")):
            return _error(502, "ai_unavailable", "The AI service returned an error.")
        return _error(500, "internal_error", "Something went wrong retrieving item insights.")

