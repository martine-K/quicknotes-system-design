# QuickNotes System Design

QuickNotes is moving from a browser-only app to an online service for 1 million users. This project has two parts:

1. **A small API client** (HTML, CSS and JavaScript) that proves the front end can talk to an API. It uses the practice API [JSONPlaceholder](https://jsonplaceholder.typicode.com/posts) to load, create and delete notes.
2. **Three design documents** that the backend team can build from: the REST API, the database model and the system architecture.

## How to run the API client

No installation is needed, but you need an internet connection because the client calls JSONPlaceholder.

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/quicknotes-system-design.git
   cd quicknotes-system-design
   ```
2. Open `index.html` in your browser (double-click it), **or** serve the folder locally:
   ```bash
   python3 -m http.server 8000
   ```
   and visit <http://localhost:8000>.
3. Click **Load notes** to fetch 10 notes (GET).
4. Fill in the form and click **Save note** to create a note (POST). The title is required and can be at most 100 characters.
5. Click **Delete** on a note to remove it (DELETE).

Note: JSONPlaceholder is a fake API. It accepts new notes and deletions and replies with success codes, but it does not store them, so the page list is updated locally and a reload brings the original notes back. This is explained in a comment in `api.js`.

### What the client does

- GET, POST and DELETE through one reusable `request()` function that checks `response.ok` and throws on errors
- Loading, success, error and empty states on the page
- Validation: a title is required and limited to 100 characters
- Buttons are disabled while a request is running
- All text from the user or the server is inserted with `textContent` (never `innerHTML`)

## Design documents

- [API design](docs/api-design.md): 10 REST endpoints, JSON examples and error codes
- [Data model](docs/data-model.md): tables, keys, relationships, SQL, index and the SQL vs NoSQL decision
- [Architecture](docs/architecture.md): requirements, load estimate for 1 million users, diagram, request flows, trade-offs and single points of failure

## Project structure

```
quicknotes-system-design/
├── index.html
├── api.js
├── style.css
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## What I learned

- **Always check `response.ok` with fetch.** `fetch` only fails on network errors; a 404 or 500 still "succeeds", so a reusable `request()` function must throw on bad status codes, and every call needs `try / catch / finally` so the page can show an error and re-enable its buttons.
- **Good UIs show every state.** Users need to see loading, success, error and empty states, and buttons must be disabled during a request to prevent double submits.
- **Untrusted text must go in with `textContent`.** It prevents injected HTML and scripts (XSS), because the browser treats the text as plain text.
- **Fake APIs behave differently from real ones.** JSONPlaceholder does not save changes, so the client has to keep its own list of notes, and I had to track notes by a local key because every created note comes back with id 101.
- **Estimates drive design.** Working out about 46 reads and 12 writes per second showed that QuickNotes is read-heavy and small enough for one database primary, so the focus is caching, a read replica and removing single points of failure rather than heavy sharding.
- **A many-to-many relationship needs a join table.** Notes and tags are linked through `note_tags`, and an index such as `(user_id, created_at DESC)` matches the most common query.
