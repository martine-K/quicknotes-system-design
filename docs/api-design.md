# QuickNotes API Design

This document describes the **real** QuickNotes REST API that the backend team should build. (The front end in this repo uses JSONPlaceholder only for practice.)

## Conventions

- Base URL: `https://api.quicknotes.example/v1`
- Format: JSON in requests and responses (`Content-Type: application/json`)
- Authentication: `Authorization: Bearer <token>` on every endpoint except register and login
- Resource names are plural nouns; the HTTP method says the action
- Timestamps use ISO 8601 in UTC, for example `2026-10-28T09:30:00Z`
- Lists are paginated with `?page=1&limit=20` (default 20, maximum 100)
- A user can only see and change their own notes and tags

## Endpoints

| # | Method | Path | Description | Success status |
|---|--------|------|-------------|----------------|
| 1 | POST | `/auth/register` | Create a new user account | 201 Created |
| 2 | POST | `/auth/login` | Exchange email and password for an access token | 200 OK |
| 3 | GET | `/notes` | List the current user's notes (supports `page`, `limit`, `tag`, `q`) | 200 OK |
| 4 | POST | `/notes` | Create a note | 201 Created |
| 5 | GET | `/notes/{id}` | Get one note | 200 OK |
| 6 | PUT | `/notes/{id}` | Replace a note's title, body and tags | 200 OK |
| 7 | DELETE | `/notes/{id}` | Delete a note | 204 No Content |
| 8 | GET | `/tags` | List the current user's tags | 200 OK |
| 9 | PUT | `/notes/{id}/tags/{tagId}` | Attach an existing tag to a note (safe to repeat) | 204 No Content |
| 10 | DELETE | `/notes/{id}/tags/{tagId}` | Remove a tag from a note | 204 No Content |

## Examples

### Create a note: `POST /notes`

Rules: `title` is required (1 to 100 characters), `body` is optional (up to 10,000 characters), `tags` is optional (a list of tag names; missing tags are created).

Request:

```http
POST /v1/notes
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json
```

```json
{
  "title": "Buy groceries",
  "body": "Milk, eggs, bread",
  "tags": ["home", "shopping"]
}
```

Response: `201 Created`, with a `Location: /v1/notes/101` header

```json
{
  "id": 101,
  "title": "Buy groceries",
  "body": "Milk, eggs, bread",
  "tags": ["home", "shopping"],
  "createdAt": "2026-10-28T09:30:00Z",
  "updatedAt": "2026-10-28T09:30:00Z"
}
```

### List notes: `GET /notes?page=1&limit=2&tag=home`

Response: `200 OK`

```json
{
  "data": [
    {
      "id": 101,
      "title": "Buy groceries",
      "body": "Milk, eggs, bread",
      "tags": ["home", "shopping"],
      "createdAt": "2026-10-28T09:30:00Z",
      "updatedAt": "2026-10-28T09:30:00Z"
    },
    {
      "id": 98,
      "title": "Fix the tap",
      "body": "",
      "tags": ["home"],
      "createdAt": "2026-10-27T18:05:00Z",
      "updatedAt": "2026-10-27T18:05:00Z"
    }
  ],
  "page": 1,
  "limit": 2,
  "total": 14
}
```

An empty list is not an error: it returns `200 OK` with `"data": []` and `"total": 0`.

## Error responses

Errors use the right HTTP status code and one consistent JSON body.

| Status | Name | When it is returned |
|--------|------|---------------------|
| 400 | Bad Request | The JSON is malformed or fails validation (for example an empty title or a title over 100 characters) |
| 401 | Unauthorized | The token is missing, invalid or expired, or the login credentials are wrong |
| 403 | Forbidden | The user is logged in but not allowed to do this, for example touching another user's note |
| 404 | Not Found | The note or tag does not exist |
| 409 | Conflict | The email is already registered |
| 429 | Too Many Requests | The client exceeded the rate limit (the `Retry-After` header says when to retry) |
| 500 | Internal Server Error | An unexpected failure on the server (the response never leaks internal details) |

Error body format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title must be between 1 and 100 characters.",
    "details": [
      { "field": "title", "issue": "too_long", "max": 100 }
    ],
    "requestId": "req_7f3a91c2"
  }
}
```

Other examples:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Access token is missing or expired.", "requestId": "req_1b22ce07" } }
```

```json
{ "error": { "code": "NOT_FOUND", "message": "Note 999 does not exist.", "requestId": "req_c91d4a10" } }
```

```json
{ "error": { "code": "INTERNAL_ERROR", "message": "Something went wrong. Please try again.", "requestId": "req_55e0b3aa" } }
```

## Design notes

- `PUT` replaces the whole note (and is idempotent); sending the same request twice gives the same result.
- `DELETE` returns `204` with no body. Deleting an already deleted note returns `404`.
- Returning `403` (not `404`) for another user's note is clear for developers. If the team prefers to hide that a note exists, use `404` instead.
- The API is versioned in the path (`/v1`) so later breaking changes can go to `/v2`.
