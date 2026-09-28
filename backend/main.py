from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from serp_client import search
from llm_extract import infer_and_extract

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class SearchRequest(BaseModel):
    query: str


@app.post("/search")
def do_search(req: SearchRequest):
    items, engine_used = search(req.query)
    return infer_and_extract(req.query, items)
