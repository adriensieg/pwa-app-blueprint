import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT_PATH = os.getenv("ROOT_PATH", "/troubleshoot").rstrip("/")
APP_TITLE = os.getenv("APP_TITLE", "Troubleshoot")
BASE_DIR = Path(__file__).resolve().parent

# Placeholder service. No PWA assets — the hub owns the single PWA.
app = FastAPI(title=APP_TITLE, root_path=ROOT_PATH)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.get("/health", response_class=PlainTextResponse, include_in_schema=False)
def health():
    return "ok"


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "app_title": APP_TITLE, "root_path": ROOT_PATH},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
