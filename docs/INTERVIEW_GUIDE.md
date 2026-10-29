# CivicFix Interview Guide

Use this as a preparation sheet, not as a script to memorise. Be ready to explain any code claim by opening the corresponding source file and walking through a small example.

## 60-second project pitch

"CivicFix is a full-stack civic issue reporting and repair-planning prototype. Citizens can register, submit location-linked issues and track their status. Admins manage road closures and generate repair plans. PostgreSQL stores identity, road-network, planning-history and audit data; MongoDB stores report documents. Dijkstra finds reachable shortest paths, two-constraint 0/1 knapsack DP selects repairs under both budget and one-crew-hour limits, and Held–Karp orders up to 12 stops exactly. I added short versioned sessions, same-origin mutation checks, paginated reports, persistent audit events and PostgreSQL/MongoDB integration tests. The data is fictional and the urgency score is illustrative, so I describe it as a decision-support portfolio prototype, not a validated city service."

## Explain the request flow

1. Browser JavaScript calls the same-origin Express API with credentials included.
2. Login validates user input, compares the password with a bcrypt hash, and sets an expiring signed JWT in an HttpOnly cookie.
3. Middleware verifies the cookie and adds the verified identity to the request. Admin routes additionally check the role.
4. A report submission validates the fields and checks that the selected road-graph node exists in PostgreSQL before writing the report to MongoDB.
5. The planner loads reports and road edges, removes closed edges, computes reachability/distances, selects candidate repairs under the budget, orders the chosen stops and returns the plan to the UI.

## Why use two databases?

- PostgreSQL is a good fit for relational data and integrity constraints: users, crews, nodes, edges and saved planning runs.
- MongoDB supports report documents whose fields can vary over time, including report metadata and timestamps.
- Report content is authoritative in MongoDB; PostgreSQL is checked for the selected graph node and a separate PostgreSQL audit event is written after the report insert. There is no atomic distributed transaction across MongoDB and PostgreSQL; the audit service logs persistence failures but does not roll back the report. A production extension that requires guaranteed audit delivery should add an outbox/reconciliation approach. If the schema and team do not need document flexibility, one relational database could be simpler.

## DSA and complexity

### Dijkstra with a binary heap

- **Why:** road lengths are non-negative and the app needs shortest distances between locations.
- **Representation:** adjacency list.
- **Closed roads:** closed edges are excluded while building the graph.
- **Typical time:** `O((V + E) log V)` with a binary heap.
- **Discuss:** unreachable nodes, stale heap entries, same source/destination and why BFS is not correct for arbitrary weighted road lengths.

### 0/1 knapsack DP

- **Why:** each repair is either selected or not selected, and both budget and one crew's working-hour capacity must be respected.
- **Weights:** repair cost rounded up to ₹1,000 units and estimated repair hours rounded up to whole hours.
- **Value:** illustrative urgency score based on severity and bounded age.
- **Time:** `O(nBH)`, where `B` is the capped budget capacity in ₹1,000 units (at most 5,000) and `H` is the configured crew-hour capacity (1–80).
- **Memory:** score rows are rolled, while reconstruction decisions are retained per item/cost/hour state, so worst-case memory is `O(nBH)`.
- **Discuss:** rounding up prevents overspending, and the score weights are policy assumptions that should be calibrated rather than treated as objective truth.

### Held–Karp bitmask DP for route order

- **State:** best open-route cost for a set of visited stops ending at a given stop.
- **Time:** `O(2^k * k^2)`.
- **Memory:** `O(2^k * k)`.
- **Limit:** exact ordering is used for up to 12 stops; larger sets use the API-reported nearest-neighbour heuristic.
- **Discuss:** this is a small-stop route-ordering problem, not a full vehicle-routing problem with multiple crews, capacity, time windows or a required return to the depot.

## Security decisions

- Passwords are bcrypt hashes; never store or log plaintext passwords.
- The session JWT is in an HttpOnly cookie, not browser localStorage.
- Auth endpoints are rate-limited and cookie settings include SameSite; the login path rejects passwords over bcrypt's 72-byte input limit.
- Sessions expire after 30 minutes; protected requests check current role and `token_version` against PostgreSQL. Citizen registration cannot request an admin role.
- State-changing API requests require a same-origin custom header and reject mismatched Origins.
- Structured auth/report/road/planner audit events are persisted in PostgreSQL, with login failures logged without email/password data.
- CI runs algorithm/property tests and API integration tests against disposable PostgreSQL and MongoDB service containers; that is regression coverage, not a security audit.

## Questions to practise

1. Why did you choose Dijkstra instead of BFS or Floyd–Warshall?
2. How does your graph represent an inaccessible or closed road?
3. Why does knapsack match this budget decision? What is its pseudo-polynomial parameter?
4. Why round cost up instead of to the nearest ₹1,000?
5. What happens if a report's location is disconnected from the depot?
6. Why is Held–Karp limited to 12 stops? What does the fallback lose?
7. What consistency guarantee exists between MongoDB report writes and PostgreSQL audit events, and what would an outbox/reconciliation flow improve?
8. How do you stop a citizen from changing a report to Resolved or closing roads?
9. Which tests compare an algorithm against a slower reference implementation?
10. What would you change before using real city data?

## Do not overclaim

- The demo graph and reports are fictional; the map is schematic.
- The urgency weights are an example policy, not a validated safety metric.
- The planner respects repair budget and a single crew-hour limit, but does not optimise travel cost, assign specialty-matched crews, or model shifts/time windows.
- Database-backed API integration tests are present in CI. A production security audit, email-based account recovery, reliable backups, file upload/storage and moderation/privacy controls are still outstanding.
- Add a public demo URL to the repository only after deploying and manually verifying login, reports, admin controls and planner behaviour.
