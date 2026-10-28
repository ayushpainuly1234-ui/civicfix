# CivicFix — Civic Issue Reporting & Repair Planner

![CI](https://github.com/ayushpainuly1234-ui/civicfix/actions/workflows/ci.yml/badge.svg) ![Node.js](https://img.shields.io/badge/Node.js-20%2B-43853D?logo=node.js&logoColor=white) ![License](https://img.shields.io/badge/license-not%20specified-lightgrey)

> **Live demo:** Not deployed yet. Deployment is prepared in [`render.yaml`](render.yaml); follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) after configuring managed PostgreSQL and MongoDB credentials.

**Quick links:** [Architecture](docs/ARCHITECTURE.md) · [Deployment guide](docs/DEPLOYMENT.md) · [API reference](#main-api-routes) · [Interview notes](#how-to-explain-the-dsa-in-an-interview)

CivicFix is a portfolio-grade full-stack application for reporting local infrastructure issues and planning repair work with limited budget. It is designed around a practical operations problem: *given a set of community-reported issues, a repair budget and some closed roads, which issues should the team prioritise, and how can the team reach those sites?*

> **Demo / scope:** This is a locally runnable portfolio project with seeded fictional demo data. It is not an official city service. Cost estimates and severity scores are example inputs, not government quotes or a validated public-safety scoring system. The planner is a decision aid on a small seeded graph, not a full vehicle-routing solver (single crew, no time windows).

## What it does

- Citizen registration and sign-in, with passwords hashed using bcrypt and an HttpOnly session cookie containing a signed JWT.
- Report roads, streetlights, waste, water leaks and accessibility issues with location, severity, repair cost and work-hour estimates.
- Admin dashboard to update report statuses and mark road segments as open or closed.
- **Graph / Dijkstra:** models the road network as an adjacency list and uses a binary min-heap priority queue to find shortest paths while skipping closed roads.
- **Dynamic programming / 0/1 knapsack:** chooses a set of reachable repair issues with the highest urgency score without exceeding a repair budget. Cost is rounded up to ₹1,000 units to bound the DP array size.
- **Route ordering:** up to 12 stops are ordered *exactly* with Held-Karp bitmask DP over Dijkstra shortest-path distances (open route, no return to depot); beyond 12 it falls back to a nearest-neighbour heuristic and says so in the API response (`routeMethod`).
- PostgreSQL stores users, crews, graph nodes/edges and planning history. MongoDB stores flexible citizen issue reports.
- Responsive HTML/CSS/vanilla JavaScript frontend, API validation, authentication rate limiting, security headers and algorithm unit tests.

## Key user flows

1. Create a citizen account and sign in.
2. Submit an infrastructure report tied to a seeded map location.
3. Browse reports and filter by status.
4. Admin reviews status, changes road closures and runs a repair plan.
5. Planner returns a budget-fitting repair selection plus a route through reachable locations.

## Technology stack

- Frontend: semantic HTML, CSS, browser JavaScript
- Backend: Node.js, Express
- Data: PostgreSQL (SQL) and MongoDB
- Algorithms: Dijkstra with a min-priority queue; 0/1 knapsack DP; Held-Karp bitmask DP
- Tests: Node's built-in test runner
- Local databases: Docker Compose

## Run locally

Prerequisites: Node.js 20+, Docker Desktop with Compose, and a terminal. Start from the extracted project directory.

1. Copy `.env.example` to `.env` and replace `JWT_SECRET` with a random secret at least 32 characters long. For local-only demo you can keep the other example values.

   PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux:
   ```bash
   cp .env.example .env
   ```

2. Start PostgreSQL and MongoDB:
   ```bash
   docker compose up -d
   ```

3. Install Node dependencies and seed the local schema, graph, crews, admin and fictional report data:
   ```bash
   npm install
   npm run db:seed
   ```

4. Start the application:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:4000](http://localhost:4000). Frontend and REST API are served from the same origin. The health endpoint is [http://localhost:4000/api/health](http://localhost:4000/api/health).

### Local demo admin account

The `.env.example` uses a convenience account for local evaluation:

- Email: `admin@civicfix.local`
- Password: `CivicFixDemo!2026`

**Local demo only. Do not deploy these credentials.** Change `ADMIN_PASSWORD`, change `JWT_SECRET`, and use managed databases before any public deployment. The seed command updates that local admin account's password from the environment on each run. Ordinary sign-ups get the `citizen` role; public registration cannot assign admin privileges.

## Tests

The algorithm tests do not require either database to be running. Besides example-based tests there are seeded randomized property tests: Dijkstra vs Floyd-Warshall, knapsack DP vs brute-force subsets, and Held-Karp vs brute-force permutations.

```bash
npm test
```

They cover Dijkstra's shortest path, closed roads, unreachable nodes, DP budget selection, age bonus and multi-stop route legs. End-to-end tests against PostgreSQL and MongoDB have not been included in this starter; run the app and test the API flows locally before presenting it as production-ready.

## Main API routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create a citizen account |
| `POST` | `/api/auth/login` | Public | Verify credentials and set session cookie |
| `POST` | `/api/auth/logout` | Public | Clear session cookie |
| `GET` | `/api/auth/me` | Signed in | Current user |
| `GET` | `/api/dashboard/summary` | Public | Summary metrics |
| `GET` | `/api/reports` | Public | Browse issue reports |
| `POST` | `/api/reports` | Signed in | Submit an issue |
| `PATCH` | `/api/reports/:id/status` | Admin | Change an issue status |
| `GET` | `/api/graph` | Public | Road network nodes and edges |
| `PATCH` | `/api/graph/edges/:id/status` | Admin | Open/close road segment |
| `GET` | `/api/crews` | Public | Crew directory |
| `POST` | `/api/planning/optimize` | Admin | Run DP selection and route planning |
| `GET` | `/api/planning/history` | Admin | Recent plans |

## Architecture and deployment

- [Architecture notes](docs/ARCHITECTURE.md) explain component boundaries, request flows, database responsibilities, security boundaries and algorithm trade-offs.
- [Deployment guide](docs/DEPLOYMENT.md) covers Neon PostgreSQL, MongoDB Atlas, Render Blueprint setup, environment variables and verification steps.
- GitHub Actions runs `npm ci` and the Node.js test suite on pushes and pull requests. The badge at the top reflects the most recent workflow status.

## Repository structure

```text
civicfix/
├── public/                 # HTML, CSS and browser JavaScript
├── src/
│   ├── db/                 # SQL schema, Mongo/Postgres connections, seeder
│   ├── middleware/         # Session auth and role guards
│   ├── routes/             # REST endpoints
│   ├── services/           # Dijkstra, knapsack DP, route ordering
│   ├── app.js
│   └── server.js
├── tests/                  # Unit and randomized property tests
├── docs/                   # Architecture and deployment guides
├── render.yaml             # Render Blueprint for the Node service
├── docker-compose.yml
├── .env.example
└── README.md
```

## Security and limitations

- Passwords are stored as bcrypt hashes, never plaintext.
- JWT is stored in an HttpOnly, SameSite=Strict cookie; it is not exposed to browser JavaScript. HTTPS is required for production cookies.
- This is a learning project, not a security-audited production service. Before public deployment, add HTTPS and managed secret storage, CSRF defence aligned with the deployment topology, account recovery, stronger audit logging, DB backups, admin provisioning workflow, monitoring and end-to-end tests. Review rate limiting for deployment behind a proxy.
- Reports are readable publicly in this demo. Never include private personal data in report text. A real deployment should define moderation, privacy and data-retention policies.
- The admin demo password is intentionally convenient for local development only.
- Map coordinates are schematic, not real geospatial coordinates. The project uses a seeded road graph, not a live map provider or real-time traffic feed.
- DP uses an urgency score (`severity * 100 + up to 30 points for age`). This is a demonstrative scoring rule and should be calibrated with real stakeholders before operational use.

## How to explain the DSA in an interview

**Dijkstra:** each graph node is a mapped location and each weighted edge is a road length. A min-priority queue selects the unprocessed location with the lowest known distance; closed roads are omitted from the graph. With a binary heap the usual bound is `O((V + E) log V)`.

**0/1 knapsack DP:** each unresolved, reachable report is an item. Its integer weight is the repair cost rounded up in ₹1,000 units, and its value is the urgency score. The DP table records the best score achievable using the first `i` reports with budget capacity `b`. Each report can be selected at most once. Complexity is `O(n * B)` where `B` is the number of ₹1,000 budget units (capped at 5,000 in the API), with `O(n * B)` memory for straightforward reconstruction.

**Held-Karp (route order):** `dp[mask][last]` = shortest distance that visits the set `mask` of stops and ends at `last`. Transitions add one unvisited stop; the answer is the best `dp[full][last]`. Time `O(2^k * k^2)`, memory `O(2^k * k)`, so it is exact but only practical for small `k` (capped at 12 here). Pairwise distances come from `k + 1` Dijkstra runs, not one per pair. Above the cap a nearest-neighbour heuristic is used and reported as such.

**Honest limits:** knapsack picks repairs by urgency only and ignores travel cost and crew hours (`estimatedHours` is collected but not yet a constraint); one crew, one depot, undirected roads.

## Roadmap / known gaps

- Add crew-hours as a second knapsack constraint (2-D DP) and match crew specialty to issue category.
- JWT role is embedded for 8h, so a demoted admin keeps access until expiry; add a token version or short-lived tokens + refresh.
- No end-to-end API tests against real databases yet (algorithms are covered by unit and property tests).
- Reports have no pagination beyond a fixed 100-item cap.

## Resume bullet (use only after you run and validate it yourself)

**CivicFix — Civic Issue Reporting & Repair Planner** | Node.js, Express, PostgreSQL, MongoDB, HTML, CSS, JavaScript

- Built a civic-issue reporting platform with role-based APIs and dual-database persistence for citizen reports, road-network data, crews and repair-plan history.
- Implemented Dijkstra shortest paths over a weighted road graph with closed-road filtering and 0/1 knapsack DP to prioritise repairs under a fixed budget.
- Added automated algorithm tests for route correctness, unreachable nodes and budget constraints.
