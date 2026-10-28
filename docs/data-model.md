# QuickNotes Data Model

## Entities

### users
| Column | Type | Key / constraint |
|--------|------|------------------|
| id | BIGINT (identity) | **Primary key** |
| email | VARCHAR(255) | NOT NULL, UNIQUE |
| password_hash | VARCHAR(255) | NOT NULL |
| display_name | VARCHAR(100) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |

### notes
| Column | Type | Key / constraint |
|--------|------|------------------|
| id | BIGINT (identity) | **Primary key** |
| user_id | BIGINT | **Foreign key** to users(id), NOT NULL |
| title | VARCHAR(100) | NOT NULL, not empty |
| body | TEXT | NOT NULL, default empty string |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

### tags
| Column | Type | Key / constraint |
|--------|------|------------------|
| id | BIGINT (identity) | **Primary key** |
| user_id | BIGINT | **Foreign key** to users(id), NOT NULL |
| name | VARCHAR(50) | NOT NULL; UNIQUE together with user_id |

### note_tags (join table)
| Column | Type | Key / constraint |
|--------|------|------------------|
| note_id | BIGINT | **Primary key (part 1)** and **foreign key** to notes(id) |
| tag_id | BIGINT | **Primary key (part 2)** and **foreign key** to tags(id) |

## Relationships

```
users 1 ───< notes
users 1 ───< tags
notes >───< tags      (through note_tags)
```

- **One-to-many, users to notes:** one user owns many notes, but each note belongs to exactly one user. This is implemented with `notes.user_id`, a foreign key to `users.id`.
- **One-to-many, users to tags:** one user owns many tags; each tag belongs to one user (so two users can both have a tag called "work" without clashing).
- **Many-to-many, notes to tags:** one note can have many tags, and one tag can be on many notes. A relational database cannot store this in a single column, so the join table `note_tags` holds one row per (note, tag) pair. Its composite primary key `(note_id, tag_id)` stops the same tag being attached twice.

## CREATE TABLE statements (PostgreSQL)

```sql
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE notes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(100) NOT NULL CHECK (length(trim(title)) > 0),
    body       TEXT         NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    VARCHAR(50) NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
    note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  BIGINT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

-- Index for the most common query (see below)
CREATE INDEX idx_notes_user_created ON notes (user_id, created_at DESC);
-- Index for finding all notes with a given tag
CREATE INDEX idx_note_tags_tag ON note_tags (tag_id);
```

## Example queries

**1. List a user's 20 newest notes (page 1)** (`GET /notes`)

```sql
SELECT id, title, body, created_at
FROM notes
WHERE user_id = 42
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

**2. List a user's notes with their tags, using a JOIN** (`GET /notes` with tags in the response)

```sql
SELECT n.id, n.title, n.created_at,
       COALESCE(string_agg(t.name, ', ' ORDER BY t.name), '') AS tags
FROM notes n
LEFT JOIN note_tags nt ON nt.note_id = n.id
LEFT JOIN tags t       ON t.id = nt.tag_id
WHERE n.user_id = 42
GROUP BY n.id
ORDER BY n.created_at DESC
LIMIT 20;
```

**3. Find a user's notes that have the tag "home"** (`GET /notes?tag=home`)

```sql
SELECT n.id, n.title
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
JOIN tags t       ON t.id = nt.tag_id
WHERE n.user_id = 42 AND t.name = 'home'
ORDER BY n.created_at DESC;
```

**4. Count notes per tag for one user**

```sql
SELECT t.name, COUNT(nt.note_id) AS note_count
FROM tags t
LEFT JOIN note_tags nt ON nt.tag_id = t.id
WHERE t.user_id = 42
GROUP BY t.id, t.name
ORDER BY note_count DESC;
```

**5. Create a note** (`POST /notes`)

```sql
INSERT INTO notes (user_id, title, body)
VALUES (42, 'Buy groceries', 'Milk, eggs, bread')
RETURNING id, created_at;
```

## Index and why

`idx_notes_user_created ON notes (user_id, created_at DESC)`

Almost every read is "show me *my* newest notes". Without an index, the database would scan all notes of all users (hundreds of millions of rows after a few years) and sort them. With this composite index, it jumps straight to one user's rows, which are already stored in newest-first order, so the query reads only the 20 rows it needs. The cost is slightly slower inserts and a bit more disk space, which is a good trade because reads are much more frequent than writes. The primary keys and the `UNIQUE` constraints also create indexes automatically; `idx_note_tags_tag` speeds up the "notes with tag X" query because the composite primary key only helps lookups that start from `note_id`.

## SQL or NoSQL?

**Choice: SQL (PostgreSQL).** The data is clearly relational: users own notes and tags, and notes and tags have a many-to-many relationship, which a join table and foreign keys model cleanly and enforce (no note can point to a user who does not exist). Queries such as "notes with tag X for user Y" need joins and filters that SQL does well. Transactions guarantee that creating a note and its tags either fully succeeds or fully fails. At 1 million users the load (about 12 writes per second on average, under 1 TB per year) is easily within what one PostgreSQL primary and a read replica can handle, so we do not need NoSQL's horizontal write scaling yet. If the service ever grows far beyond that, we can shard notes by `user_id`, or move full-text search to a dedicated search engine, without changing the core model.
