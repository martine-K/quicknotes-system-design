// QuickNotes API client (practice version using JSONPlaceholder).
// Supports GET (load 10 notes), POST (create) and DELETE (remove).

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const MAX_TITLE_LENGTH = 100;

// ---- DOM references ---------------------------------------------------
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const form = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");
const notesList = document.getElementById("notes-list");

// ---- State --------------------------------------------------------------
// The list on the page is driven by this array. Each item gets a local
// "key" because JSONPlaceholder returns the SAME id (101) for every note we
// create, so the server id alone cannot tell our new notes apart.
let notes = [];
let nextKey = 1;

// ---- Helpers ------------------------------------------------------------

// Shows a message in the status line. type: "loading" | "success" | "error".
function setStatus(message, type) {
  statusEl.textContent = message; // textContent only: never innerHTML
  statusEl.className = type ? "status-" + type : "";
}

// Disables or enables every button while a request is running.
function setBusy(isBusy) {
  loadBtn.disabled = isBusy;
  submitBtn.disabled = isBusy;
  notesList.querySelectorAll("button").forEach((btn) => {
    btn.disabled = isBusy;
  });
}

// Reusable request function: calls fetch, checks response.ok, throws on
// errors and returns { status, data } on success.
async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error("Request failed with status " + response.status);
  }
  // Some APIs return an empty body (for example 204); handle that safely.
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

// Draws the list. Every piece of user/server text goes in via textContent.
function renderNotes() {
  notesList.replaceChildren();

  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No notes yet. Click \"Load notes\" or write one above.";
    notesList.appendChild(empty);
    return;
  }

  notes.forEach((note) => {
    const item = document.createElement("li");
    item.className = "note";

    const title = document.createElement("h3");
    title.textContent = note.title;

    const body = document.createElement("p");
    body.textContent = note.body || "(no body)";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.dataset.key = String(note.key);
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", "Delete note: " + note.title);

    item.append(title, body, deleteBtn);
    notesList.appendChild(item);
  });
}

// ---- GET: load 10 notes -------------------------------------------------
async function loadNotes() {
  setBusy(true);
  setStatus("Loading notes...", "loading");
  try {
    const { data } = await request(API_URL + "?_limit=10");
    notes = data.map((n) => ({ key: nextKey++, id: n.id, title: n.title, body: n.body }));
    renderNotes();
    if (notes.length === 0) {
      setStatus("The server has no notes yet.", "success");
    } else {
      setStatus("Loaded " + notes.length + " notes from the server.", "success");
    }
  } catch (error) {
    console.error(error);
    setStatus("Sorry, we could not load your notes. Check your connection and try again.", "error");
  } finally {
    setBusy(false);
  }
}

// ---- Validation ---------------------------------------------------------
// Returns an error message, or "" when the title is valid.
function validateTitle(title) {
  if (title.length === 0) return "Please enter a title.";
  if (title.length > MAX_TITLE_LENGTH) {
    return "The title is too long (" + title.length + " characters). Use " + MAX_TITLE_LENGTH + " or fewer.";
  }
  return "";
}

// ---- POST: create a note ------------------------------------------------
async function createNote(event) {
  event.preventDefault();

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  const problem = validateTitle(title);
  if (problem) {
    setStatus(problem, "error");
    titleInput.setAttribute("aria-invalid", "true");
    titleInput.focus();
    return;
  }
  titleInput.removeAttribute("aria-invalid");

  setBusy(true);
  setStatus("Saving note...", "loading");
  try {
    const { status, data } = await request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ title, body, userId: 1 }),
    });
    // Newest note goes to the top of the list.
    notes.unshift({ key: nextKey++, id: data.id, title: data.title, body: data.body });
    renderNotes();
    form.reset();
    setStatus("Note created (status " + status + ", id " + data.id + ").", "success");
  } catch (error) {
    console.error(error);
    setStatus("Sorry, the note could not be saved. Your text is still in the form, so try again.", "error");
  } finally {
    setBusy(false);
  }
}

// ---- DELETE: remove a note ----------------------------------------------
// JSONPlaceholder is a fake API: it ACCEPTS our POST and DELETE requests and
// replies with success codes, but it never really saves or removes anything.
// So the server's reply (2xx) is our proof the "delete" was accepted, and we
// then remove the note from our own local list (`notes`) to update the page.
// Consequences: a created note is only visible until the page is reloaded,
// and deleted notes come back after clicking "Load notes" again. A real
// backend would persist both changes.
async function deleteNote(key) {
  const note = notes.find((n) => n.key === key);
  if (!note) return;

  setBusy(true);
  setStatus("Deleting note...", "loading");
  try {
    const { status } = await request(API_URL + "/" + note.id, { method: "DELETE" });
    notes = notes.filter((n) => n.key !== key);
    renderNotes();
    setStatus("Note deleted (status " + status + ").", "success");
  } catch (error) {
    console.error(error);
    setStatus("Sorry, the note could not be deleted. It is still in your list.", "error");
  } finally {
    setBusy(false);
  }
}

// ---- Wire up events -------------------------------------------------------
loadBtn.addEventListener("click", loadNotes);
form.addEventListener("submit", createNote);
// One listener on the list handles every Delete button (event delegation).
notesList.addEventListener("click", (event) => {
  const btn = event.target.closest(".delete-btn");
  if (btn) deleteNote(Number(btn.dataset.key));
});

renderNotes(); // shows the empty state before anything is loaded
