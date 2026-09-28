import os, json, requests
from dotenv import load_dotenv

load_dotenv()

params = {
    "engine": "google_shopping",
    "q": "laptops under 60000",
    "gl": "in",
    "hl": "en",
    "api_key": os.environ["SERPAPI_API_KEY"],
}

data = requests.get("https://serpapi.com/search", params=params).json()

with open("shopping_raw.json", "w") as f:
    json.dump(data, f, indent=2)

print("Top-level keys:", list(data.keys()))
if data.get("shopping_results"):
    print(json.dumps(data["shopping_results"][0], indent=2))
else:
    print("No shopping_results — inspect shopping_raw.json for what came back instead")
