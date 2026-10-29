CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'admin')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive migration for databases created before session-version invalidation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id VARCHAR(60) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  zone VARCHAR(100) NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'junction',
  map_x INTEGER NOT NULL DEFAULT 50,
  map_y INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id BIGSERIAL PRIMARY KEY,
  source_node_id VARCHAR(60) NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id VARCHAR(60) NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  distance_km NUMERIC(7, 3) NOT NULL CHECK (distance_km > 0),
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(source_node_id, target_node_id)
);

CREATE TABLE IF NOT EXISTS crews (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  specialty VARCHAR(100) NOT NULL,
  base_node_id VARCHAR(60) REFERENCES graph_nodes(id),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS planning_runs (
  id BIGSERIAL PRIMARY KEY,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  start_node_id VARCHAR(60) NOT NULL REFERENCES graph_nodes(id),
  budget_limit INTEGER NOT NULL CHECK (budget_limit >= 0),
  total_cost INTEGER NOT NULL,
  priority_score INTEGER NOT NULL,
  selected_report_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_node_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  distance_km NUMERIC(9, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID,
  event_type VARCHAR(80) NOT NULL,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20) NOT NULL DEFAULT 'anonymous',
  outcome VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  resource_type VARCHAR(80),
  resource_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON audit_logs (actor_id, created_at DESC);
