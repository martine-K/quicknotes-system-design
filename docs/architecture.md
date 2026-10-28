# QuickNotes Architecture

Goal: move QuickNotes from a browser-only app to an online service for **1 million users**.

## 1. Requirements

### Functional requirements
- Users can register, log in and log out.
- Users can create, view, edit and delete their own notes (title up to 100 characters, optional body).
- Users can organise notes with tags and filter their list by tag.
- Users can list their notes, newest first, with pagination.
- A user's notes are private: nobody else can read or change them.
- Notes are available from any device (web and mobile).

### Non-functional requirements
- **Availability:** 99.9% uptime; no single point of failure.
- **Performance:** listing notes in under 200 ms for 95% of requests.
- **Scalability:** handle 1 million users now and grow 10x by adding servers, not by rewriting.
- **Durability:** a saved note is never lost (backups plus replication).
- **Security:** HTTPS everywhere, hashed passwords, per-user access control.
- **Consistency:** a user sees their own new note immediately; other data may be a few seconds stale.

## 2. Assumptions and load estimate (1 million users)

Assumptions:
- 1,000,000 registered users; **20% are active each day** = 200,000 daily active users (DAU)
- Each active user loads their notes **20 times per day** (reads) and creates **5 notes per day** (writes)
- Average note (title, body, tags, metadata) is about **2 KB**
- Traffic is spread over 86,400 seconds; **peak = 5x average**

| Metric | Calculation | Average | Peak (5x) |
|--------|-------------|---------|-----------|
| Reads per second | 200,000 x 20 = 4,000,000 per day / 86,400 | **about 46 reads/s** | about 230 reads/s |
| Writes per second | 200,000 x 5 = 1,000,000 per day / 86,400 | **about 12 writes/s** | about 58 writes/s |
| Storage per year | 1,000,000 notes/day x 2 KB = 2 GB/day x 365 | **about 730 GB/year** | n/a |

Conclusions:
- The system is **read-heavy (about 4:1)**, so caching and read replicas pay off most.
- These numbers are small. A single database primary can handle the writes, so the design focuses on **availability and low latency** rather than raw capacity. Everything has a second copy so it keeps working if one part fails.
- Storage grows by under 1 TB per year (a bit more with indexes), which is easily handled by one database server for years.

## 3. Architecture diagram

```
                              +-------------------+
                              |  Client (browser, |
                              |   mobile app)     |
                              +---------+---------+
                                        |
                                        v
                              +-------------------+
                              |        DNS        |   quicknotes.example -> CDN / LB
                              +---------+---------+
                                        |
                                        v
                              +-------------------+
                              |        CDN        |   serves static files (HTML, CSS, JS)
                              +---------+---------+
                                        | API requests (/v1/...)
                                        v
                              +-------------------+
                              |  Load Balancer    |   (active + standby pair)
                              +----+---------+----+
                                   |         |
                      +------------+         +------------+
                      v                                   v
              +---------------+                   +---------------+
              |  App Server 1 |        ...        |  App Server 2 |   (stateless, 2+ copies)
              +---+-----+-----+                   +---+-----+-----+
                  |     |                             |     |
      +-----------+     +---------------+-------------+     +-----------+
      |                                 |                               |
      v                                 v                               v
+-----------+                  +----------------+               +-------------+
|   Cache   |   cache miss     |   Primary DB   |   enqueue     |    Queue    |
|  (Redis)  | ---------------> |  (all writes)  |   job         |             |
+-----------+                  +-------+--------+               +------+------+
      ^                                |                               |
      |                         replication                            v
      |                                v                        +-------------+
      |  cache miss on reads   +----------------+               |   Worker(s) |
      +----------------------- |  Read Replica  |               | (search     |
                               |  (reads only)  |               |  index,     |
                               +----------------+               |  backups,   |
                                                                |  emails)    |
                                                                +-------------+
```

Read path: Client -> DNS -> CDN -> Load Balancer -> App Server -> Cache -> (on miss) Read Replica.
Write path: Client -> DNS -> CDN -> Load Balancer -> App Server -> Primary DB (then invalidate cache, enqueue a job).

## 4. Components: one sentence each

- **Client:** the browser or mobile app that shows notes and calls the API, so the user has an interface.
- **DNS:** it translates the friendly name `quicknotes.example` into the address of the CDN or load balancer, and can redirect traffic to another region if one fails.
- **CDN:** it serves static files (HTML, CSS, JavaScript) from servers close to the user, so pages load fast and our servers are not bothered by static traffic.
- **Load balancer:** it spreads requests across several app servers and stops sending traffic to a broken one, so no single server is overloaded or a single point of failure.
- **App servers (2 or more):** they run the API logic (authentication, validation, business rules) and keep no local state, so we can simply add more when traffic grows.
- **Cache (Redis):** it keeps recently read notes and lists in memory, so repeated reads are answered in about a millisecond without touching the database.
- **Primary database (PostgreSQL):** it is the single source of truth that stores users, notes and tags durably and handles every write.
- **Read replica:** it is a live copy of the primary that serves read queries, reducing load on the primary and acting as a standby if the primary fails.
- **Queue:** it holds background jobs created by the app servers, so slow work does not make users wait and traffic bursts are smoothed out.
- **Worker:** it takes jobs from the queue and does the slow work in the background (updating the search index, sending emails, exporting data), keeping API responses fast.

## 5. Request flows

### GET /notes (read)

1. The client sends `GET /v1/notes?page=1` with its token. DNS resolves the name and the request reaches the CDN, which passes API calls (not cacheable) on to the load balancer.
2. The load balancer picks a healthy app server.
3. The app server verifies the token (returns `401` if invalid) and reads the user id from it.
4. It builds a cache key such as `notes:user42:page1` and asks the **cache**.
5. **Cache hit:** the app server returns the stored JSON immediately (`200 OK`).
6. **Cache miss:** the app server runs the list query (see `data-model.md`) on the **read replica**.
7. It stores the result in the cache with a short expiry (for example 60 seconds) and returns `200 OK` with the notes.

### POST /notes (write)

1. The client sends `POST /v1/notes` with the JSON body and its token; it passes through DNS, CDN and the load balancer to an app server.
2. The app server authenticates the user and validates the body (title required, 1 to 100 characters). If invalid, it returns `400` with an error body.
3. It writes the note (and its tags) to the **primary database** in one transaction.
4. It **deletes the user's cached note lists** (`notes:user42:*`), so the next read is fresh.
5. It puts a job on the **queue** (for example "index note 101 for search").
6. It returns `201 Created` with the new note and a `Location` header, without waiting for the job.
7. A **worker** later takes the job from the queue, does the work, and marks it done. If it fails, it retries; after several failures the job goes to a dead-letter queue for investigation.

## 6. Trade-offs

1. **Cache: speed vs freshness.** The cache cuts database load and latency, but cached data can be out of date for up to its expiry time, and we must invalidate it correctly on writes. We accept this because reads outnumber writes, and we delete the user's cache entries on every write so they always see their own changes.
2. **Read replica: scalability vs consistency.** Replication has a small delay, so a replica may briefly lack a note that was just created. We accept eventual consistency for ordinary reads, and for a user's reads right after their own write we can read from the primary.
3. **Queue and worker: fast responses vs complexity.** Background jobs keep `POST /notes` quick, but the search index may lag by a few seconds, and we now have more parts to run, monitor and retry (including duplicate jobs, so workers must be idempotent).
4. **SQL (PostgreSQL) vs NoSQL: consistency and joins vs easy horizontal scaling.** SQL gives transactions and clean relationships; the cost is that scaling writes beyond one primary needs sharding later. At about 12 writes per second this is not a problem today.
5. **Running multiple copies: availability vs cost.** Two or more of each component means more servers to pay for, but it is what removes single points of failure.

## 7. Avoiding single points of failure

| Component | What if it fails? | How we avoid a single point of failure |
|-----------|-------------------|-----------------------------------------|
| DNS | Nobody can find the site | Use a managed DNS provider with several name servers worldwide |
| CDN | Static files unavailable | Global CDN with many edge servers; API traffic can bypass it |
| Load balancer | All traffic stops | Run an active and a standby pair (or a managed, multi-zone load balancer) with health checks and automatic failover |
| App servers | Requests fail | Two or more stateless servers in different availability zones; the balancer removes unhealthy ones and auto-scaling adds more |
| Cache | Slower reads, DB overloaded | Redis with a replica and automatic failover; the app falls back to the database if the cache is down |
| Primary database | Writes fail, data at risk | Synchronous or near-real-time replication to the replica in another zone; the replica can be **promoted** to primary automatically; regular backups with point-in-time recovery |
| Read replica | Reads move to the primary | Add a second replica; the app can fall back to the primary |
| Queue | Background jobs stop | Managed, replicated queue; notes are already saved in the database, so users are not affected and jobs run later |
| Worker | Jobs pile up | Run several workers; jobs stay in the queue until a worker finishes them |
| Whole data centre | Everything is down | Spread servers over at least two availability zones (and keep backups in another region) |
