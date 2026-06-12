-- RevenueTwin — Postgres schema (S13)
-- Multi-tenant, append-only audit. Run against an empty database.

CREATE TABLE IF NOT EXISTS tenant (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── Audit (APPEND-ONLY) ─────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  tenant_id   TEXT NOT NULL REFERENCES tenant(id),
  seq         BIGINT NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  actor       TEXT NOT NULL,
  event       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   CHAR(64) NOT NULL,
  hash        CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx      ON audit_log (tenant_id, at);
CREATE INDEX IF NOT EXISTS audit_log_subject_idx ON audit_log (tenant_id, subject);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_hash_idx ON audit_log (tenant_id, hash);

-- Enforce append-only at the database level: block UPDATE and DELETE outright.
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- For regulated deployments, place audit_log on WORM-capable storage and additionally
-- REVOKE UPDATE, DELETE ON audit_log FROM the application role.

-- ───────────────────────────── Leakage cases ─────────────────────────────
CREATE TABLE IF NOT EXISTS leakage_case (
  tenant_id            TEXT NOT NULL REFERENCES tenant(id),
  id                   TEXT NOT NULL,
  customer_id          TEXT NOT NULL,
  status               TEXT NOT NULL,
  detected_via_workiq  BOOLEAN NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  payload              JSONB NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS leakage_case_customer_idx ON leakage_case (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS leakage_case_status_idx   ON leakage_case (tenant_id, status);

-- ───────────────────────────── Twin state history ─────────────────────────────
CREATE TABLE IF NOT EXISTS twin_state (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenant(id),
  customer_id TEXT NOT NULL,
  state       TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS twin_state_lookup_idx ON twin_state (tenant_id, customer_id, at);
