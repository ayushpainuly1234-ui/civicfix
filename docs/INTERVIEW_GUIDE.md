# CivicFix Interview Guide

Use this as a preparation sheet, not as a script to memorise. Be ready to explain any code claim by opening the corresponding source file and walking through a small example.

## 60-second project pitch

"CivicFix is a full-stack civic issue reporting and repair-planning prototype. Citizens can register, report issues tied to locations, and follow report status. An admin can manage road closures and ask the planner to select repair jobs under a budget. I used PostgreSQL for users, crews and the road graph, MongoDB for flexible issue reports, Dijkstra for shortest-path routing, 0/1 knapsack DP for budget-constrained repair selection, and Held–Karp bitmask DP to order a small number of stops. The data is fictional and the urgency score is illustrative; I document those trade-offs rather than presenting this as a validated city service."

## Explain the request flow

1. Browser JavaScript calls the same-origin Express API with credentials included.
2. Login validates user input, compares the password with a bcrypt hash, and sets an expiring signed JWT in an HttpOnly cookie.
3. Middleware verifies the cookie and adds the verified identity to the request. Admin routes additionally check the role.
4. A report submission validates the fields and checks that the selected road-graph node exists in PostgreSQL before writing the report to MongoDB.
5. The planner loads reports and road edges, removes closed edges, computes reachability/distances, selects candidate repairs under the budget, orders the chosen stops and returns the plan to the UI.

## Why use two databases?

- PostgreSQL is a good fit for relational data and integrity constraints: users, crews, nodes, edges and saved planning runs.
- MongoDB supports report documents whose fields can vary over time, including report metadata and timestamps.
- Trade-off: a dual-database write is not one atomic transaction. A production extension should define retry/idempotency behaviour, monitoring and reconciliation for partial failures. If the schema and team do not need document flexibility, one relational database could be simpler.

## DSA and complexity

### Dijkstra with a binary heap

- **Why:** road lengths are non-negative and the app needs shortest distances between locations.
- **Representation:** adjacency list.
- **Closed roads:** closed edges are excluded while building the graph.
- **Typical time:** `O((V + E) log V)` with a binary heap.
- **Discuss:** unreachable nodes, stale heap entries, same source/destination and why BFS is not correct for arbitrary weighted road lengths.

### 0/1 knapsack DP

- **Why:** each repair is either selected or not selected and total estimated repair cost cannot exceed the budget.
- **Weight:** repair cost rounded up to ₹1,000 units.
- **Value:** illustrative urgency score based on severity and bounded age.
- **Time:** `O(nB)` where `B` is the capped budget capacity in ₹1,000 units.
- **Memory:** current reconstruction implementation stores DP state for item/capacity combinations, so it uses `O(nB)` memory.
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
- Auth endpoints are rate-limited and cookie settings include SameSite.
- User registration cannot request an admin role; admin APIs use a separate role guard.
- Secrets belong in environment variables/hosting secret storage, not in the repository.
- This prototype still needs additional production security work (CSRF threat-model review, account recovery, stronger audit logs, database backups, privacy/moderation policy and end-to-end tests).

## Questions to practise

1. Why did you choose Dijkstra instead of BFS or Floyd–Warshall?
2. How does your graph represent an inaccessible or closed road?
3. Why does knapsack match this budget decision? What is its pseudo-polynomial parameter?
4. Why round cost up instead of to the nearest ₹1,000?
5. What happens if a report's location is disconnected from the depot?
6. Why is Held–Karp limited to 12 stops? What does the fallback lose?
7. What can go wrong when one request writes to MongoDB while checking a PostgreSQL node?
8. How do you stop a citizen from changing a report to Resolved or closing roads?
9. Which tests compare an algorithm against a slower reference implementation?
10. What would you change before using real city data?

## Do not overclaim

- The demo graph and reports are fictional; the map is schematic.
- The urgency weights are an example policy, not a validated safety metric.
- The planner currently does not optimise crew hours, skills, travel cost and time windows together.
- Unit/property tests are present, but database-backed end-to-end tests and a production security audit are still missing.
- Add a public demo URL to the repository only after deploying and manually verifying login, reports, admin controls and planner behaviour.
