import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

APP_TITLE = os.getenv("APP_TITLE", "Incubator")
BASE_DIR = Path(__file__).resolve().parent

# The hub lives at the domain root, so it owns "/", the manifest, and the
# root-scoped service worker for the WHOLE origin.
app = FastAPI(title=APP_TITLE)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# Catalog of services shown on the hub. Each launches a separate pod behind
# the shared ingress, but the user stays inside the one installed PWA.
SERVICES = [
    {
        "name": "Scanning",
        "path": "/scanning",
        "icon": "bi-camera",
        "desc": "Take a picture of the equipment you have at home.",
    },
    {
        "name": "Troubleshoot",
        "path": "/troubleshoot",
        "icon": "bi-wrench-adjustable",
        "desc": "Diagnose and resolve an issue step by step.",
    },
]


@app.get("/health", response_class=PlainTextResponse, include_in_schema=False)
def health():
    return "ok"


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "app_title": APP_TITLE, "services": SERVICES},
    )


@app.get("/offline", response_class=HTMLResponse, include_in_schema=False)
def offline(request: Request):
    # Cached by the service worker and shown for any uncached navigation.
    return templates.TemplateResponse(
        "offline.html", {"request": request, "app_title": APP_TITLE}
    )


@app.get("/manifest.json", include_in_schema=False)
def manifest():
    # scope "/" so the single installed PWA covers every sub-app path.
    return JSONResponse(
        {
            "name": APP_TITLE,
            "short_name": APP_TITLE,
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "orientation": "portrait",
            "background_color": "#ffffff",
            "theme_color": "#2563eb",
            "icons": [
                {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
                {
                    "src": "/static/icons/icon-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "maskable",
                },
            ],
        }
    )


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    # Served from the ROOT so its scope can be "/". The header lets a file at
    # "/sw.js" claim the whole-origin scope.
    resp = FileResponse(BASE_DIR / "static" / "sw.js", media_type="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000)
