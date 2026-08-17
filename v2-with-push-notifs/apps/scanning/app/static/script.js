const ROOT = document.body.dataset.root || "";
const API = `${ROOT}/api/tasks`;

const listEl = document.getElementById("task-list");
const emptyEl = document.getElementById("empty-state");
const countEl = document.getElementById("count");
const addForm = document.getElementById("add-form");
const input = document.getElementById("task-input");

const editModal = new bootstrap.Modal("#edit-modal");
const editInput = document.getElementById("edit-input");
const editSave = document.getElementById("edit-save");
let editingId = null;

async function apiGet() { const r = await fetch(API); return r.json(); }
async function apiCreate(title) {
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
}
async function apiUpdate(id, data) {
  await fetch(`${API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
async function apiDelete(id) { await fetch(`${API}/${id}`, { method: "DELETE" }); }

function render(tasks) {
  listEl.innerHTML = "";
  countEl.textContent = tasks.filter((t) => !t.done).length;
  emptyEl.classList.toggle("d-none", tasks.length > 0);
  for (const t of tasks) {
    const li = document.createElement("li");
    li.className = "task-item" + (t.done ? " done" : "");
    li.innerHTML = `
      <button class="toggle" aria-label="Toggle"><i class="bi ${t.done ? "bi-check-circle-fill" : "bi-circle"}"></i></button>
      <span class="task-title">${escapeHtml(t.title)}</span>
      <button class="act edit" aria-label="Edit"><i class="bi bi-pencil"></i></button>
      <button class="act delete" aria-label="Delete"><i class="bi bi-trash3"></i></button>`;
    li.querySelector(".toggle").onclick = async () => { await apiUpdate(t.id, { title: t.title, done: !t.done }); load(); };
    li.querySelector(".edit").onclick = () => openEdit(t);
    li.querySelector(".delete").onclick = async () => { await apiDelete(t.id); load(); };
    listEl.appendChild(li);
  }
}

function openEdit(task) { editingId = task.id; editInput.value = task.title; editModal.show(); }
editSave.onclick = async () => {
  const title = editInput.value.trim(); if (!title) return;
  const tasks = await apiGet(); const cur = tasks.find((t) => t.id === editingId);
  await apiUpdate(editingId, { title, done: cur ? cur.done : false });
  editModal.hide(); load();
};
addForm.onsubmit = async (e) => {
  e.preventDefault(); const title = input.value.trim(); if (!title) return;
  await apiCreate(title); input.value = ""; load();
};
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
async function load() { render(await apiGet()); }
load();
