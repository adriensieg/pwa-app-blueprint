import json
import os
import random
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from pywebpush import WebPushException, webpush

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ROOT_PATH = os.getenv("ROOT_PATH", "/push").rstrip("/")
# VAPID keys: public is shared with the browser, private stays here and signs.
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@devailab.work")

# Subscription store (one JSON object per line). Swap for a DB when it grows.
SUBS_FILE = Path(os.getenv("SUBS_FILE", "/data/subscriptions.txt"))

# Scheduler
NOTIFY_INTERVAL_MIN = int(os.getenv("NOTIFY_INTERVAL_MIN", "5"))
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"

MESSAGES = [
    "Check your assets.",
    "Time to review your equipment.",
    "A quick scan keeps things tidy.",
    "Anything new to add today?",
    "Your equipment list is waiting.",
]

app = FastAPI(title="Push", root_path=ROOT_PATH)


class Subscription(BaseModel):
    endpoint: str
    keys: dict


# ---------------------------------------------------------------------------
# Subscription storage
# ---------------------------------------------------------------------------
_lock = threading.Lock()


def _read_subs() -> list[dict]:
    if not SUBS_FILE.exists():
        return []
    out = []
    for line in SUBS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _write_subs(subs: list[dict]) -> None:
    SUBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SUBS_FILE.write_text(
        "\n".join(json.dumps(s, ensure_ascii=False) for s in subs),
        encoding="utf-8",
    )


def _add_sub(sub: dict) -> None:
    with _lock:
        subs = _read_subs()
        # De-dupe by endpoint (a device re-subscribing updates its keys).
        subs = [s for s in subs if s.get("endpoint") != sub["endpoint"]]
        subs.append(sub)
        _write_subs(subs)


def _remove_sub(endpoint: str) -> None:
    with _lock:
        subs = [s for s in _read_subs() if s.get("endpoint") != endpoint]
        _write_subs(subs)


# ---------------------------------------------------------------------------
# Push delivery
# ---------------------------------------------------------------------------
def _send_one(sub: dict, payload: dict) -> bool:
    """Returns True if delivered, False if it failed (dead subs are pruned)."""
    try:
        webpush(
            subscription_info=sub,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        return True
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            # Expired/gone — prune it.
            _remove_sub(sub["endpoint"])
        return False
    except Exception:
        # Network/DNS/other — don't let one bad endpoint break the broadcast.
        return False


def _broadcast(payload: dict) -> dict:
    subs = _read_subs()
    sent = sum(1 for s in subs if _send_one(s, payload))
    return {"subscribers": len(subs), "sent": sent}


# ---------------------------------------------------------------------------
# Scheduler (server-side timer; independent of any open page)
# ---------------------------------------------------------------------------
def _scheduler_loop():
    # A running counter drives the badge number.
    count = 0
    while True:
        time.sleep(NOTIFY_INTERVAL_MIN * 60)
        count += 1
        payload = {
            "title": "Incubator",
            "body": random.choice(MESSAGES),
            "badge_count": count,
            "url": "/",
        }
        try:
            _broadcast(payload)
        except Exception:
            pass  # never let the loop die


@app.on_event("startup")
def _start_scheduler():
    if SCHEDULER_ENABLED and VAPID_PRIVATE_KEY:
        t = threading.Thread(target=_scheduler_loop, daemon=True)
        t.start()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_class=PlainTextResponse, include_in_schema=False)
def health():
    return "ok"


@app.get("/vapid-public-key", response_class=PlainTextResponse)
def vapid_public_key():
    # The frontend fetches this to subscribe the browser.
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(500, "VAPID public key not configured")
    return VAPID_PUBLIC_KEY


@app.post("/subscribe", status_code=201)
def subscribe(sub: Subscription):
    _add_sub(sub.model_dump())
    return {"status": "subscribed"}


@app.post("/unsubscribe", status_code=200)
async def unsubscribe(request: Request):
    body = await request.json()
    endpoint = body.get("endpoint")
    if not endpoint:
        raise HTTPException(400, "endpoint required")
    _remove_sub(endpoint)
    return {"status": "unsubscribed"}


@app.post("/send")
async def send_now(request: Request):
    # Manual trigger / test hook. Body: {"title","body","badge_count","url"}
    payload = await request.json()
    payload.setdefault("title", "Incubator")
    payload.setdefault("body", random.choice(MESSAGES))
    payload.setdefault("url", "/")
    return JSONResponse(_broadcast(payload))


@app.get("/stats")
def stats():
    return {
        "subscribers": len(_read_subs()),
        "interval_min": NOTIFY_INTERVAL_MIN,
        "scheduler": SCHEDULER_ENABLED,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000)
