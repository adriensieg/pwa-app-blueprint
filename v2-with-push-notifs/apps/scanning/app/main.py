import json
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

ROOT_PATH = os.getenv("ROOT_PATH", "/scanning").rstrip("/")
APP_TITLE = os.getenv("APP_TITLE", "Scanning")
DATA_FILE = Path(os.getenv("DATA_FILE", "/data/data.txt"))
BASE_DIR = Path(__file__).resolve().parent

# No manifest, no service worker here — the hub owns the single PWA.
app = FastAPI(title=APP_TITLE, root_path=ROOT_PATH)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TaskIn(BaseModel):
    title: str
    done: bool = False


class Task(TaskIn):
    id: str


def _read_all() -> list[dict]:
    if not DATA_FILE.exists():
        return []
    items = []
    for line in DATA_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def _write_all(items: list[dict]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        "\n".join(json.dumps(i, ensure_ascii=False) for i in items),
        encoding="utf-8",
    )


@app.get("/health", response_class=PlainTextResponse, include_in_schema=False)
def health():
    return "ok"


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "app_title": APP_TITLE, "root_path": ROOT_PATH},
    )


@app.get("/api/tasks", response_model=list[Task])
def list_tasks():
    return _read_all()


@app.post("/api/tasks", response_model=Task, status_code=201)
def create_task(task: TaskIn):
    items = _read_all()
    title = task.title.strip()
    if not title:
        raise HTTPException(400, "Title cannot be empty")
    new = {"id": uuid.uuid4().hex, "title": title, "done": task.done}
    items.append(new)
    _write_all(items)
    return new


@app.put("/api/tasks/{task_id}", response_model=Task)
def update_task(task_id: str, task: TaskIn):
    items = _read_all()
    for i in items:
        if i["id"] == task_id:
            i["title"] = task.title.strip()
            i["done"] = task.done
            _write_all(items)
            return i
    raise HTTPException(404, "Task not found")


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: str):
    items = _read_all()
    new_items = [i for i in items if i["id"] != task_id]
    if len(new_items) == len(items):
        raise HTTPException(404, "Task not found")
    _write_all(new_items)
    return None


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000)
