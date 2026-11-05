"""Security layer: PostGIS columns, hash-chained audit log, append-only triggers, row-level security.

Revision ID: 0002_security
Revises: 0001_schema
"""
from alembic import op

revision = "0002_security"
down_revision = "0001_schema"
branch_labels = None
depends_on = None

PHI_PATIENT_TABLES = ["consents", "screenings", "screening_images", "timeline_events", "medications",
                      "health_cards", "provider_access", "checkins", "followups"]
PHI_SCREENING_TABLES = ["decisions", "reviews"]          # linked via screening_id
PHI_IMAGE_TABLES = ["image_results", "labels"]           # linked via image_id


def upgrade() -> None:
    # ── PostGIS: geography points generated from lat/lon (always consistent, indexable) ──
    for t in ("villages", "facilities"):
        op.execute(f"""
            ALTER TABLE {t} ADD COLUMN geom geography(Point, 4326)
              GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;
            CREATE INDEX ix_{t}_geom ON {t} USING GIST (geom);
        """)
    op.execute("""
        ALTER TABLE screenings ADD COLUMN geom geography(Point, 4326)
          GENERATED ALWAYS AS (CASE WHEN lat IS NULL OR lon IS NULL THEN NULL
                               ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography END) STORED;
        CREATE INDEX ix_screenings_geom ON screenings USING GIST (geom);
    """)

    # ── Session helpers read by RLS policies (set per transaction by app.db) ──
    op.execute("""
        CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;
        CREATE OR REPLACE FUNCTION app_facility() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT coalesce(current_setting('app.facility_id', true), '') $$;
        CREATE OR REPLACE FUNCTION app_user() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT coalesce(current_setting('app.user_id', true), '') $$;
        CREATE OR REPLACE FUNCTION app_patient_scope() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT coalesce(current_setting('app.patient_scope', true), '') $$;
        CREATE OR REPLACE FUNCTION app_privileged() RETURNS boolean LANGUAGE sql STABLE AS
          $$ SELECT app_role() IN ('system', 'clinical_lead') $$;
    """)

    # ── Hash-chained, append-only audit log ──
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_hash_input(p_prev text, p_ts timestamptz, p_actor_id text, p_actor_role text,
            p_action text, p_entity_type text, p_entity_id text, p_patient_id text, p_details jsonb)
        RETURNS text LANGUAGE sql IMMUTABLE AS $$
          SELECT p_prev || '|' || to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                 p_actor_id || '|' || p_actor_role || '|' || p_action || '|' || p_entity_type || '|' ||
                 coalesce(p_entity_id, '') || '|' || coalesce(p_patient_id, '') || '|' ||
                 coalesce(p_details, '{}'::jsonb)::text
        $$;

        CREATE OR REPLACE FUNCTION audit_append(p_actor_id text, p_actor_role text, p_action text,
            p_entity_type text, p_entity_id text, p_patient_id text, p_details jsonb,
            p_request_id text, p_ip text)
        RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        DECLARE v_prev text; v_ts timestamptz := date_trunc('microseconds', clock_timestamp()); v_id bigint;
        BEGIN
          PERFORM pg_advisory_xact_lock(727274001);           -- serialise appends across API replicas
          SELECT hash INTO v_prev FROM audit_log ORDER BY id DESC LIMIT 1;
          v_prev := coalesce(v_prev, repeat('0', 64));
          INSERT INTO audit_log (ts, actor_id, actor_role, action, entity_type, entity_id, patient_id, details,
                                 request_id, ip, prev_hash, hash)
          VALUES (v_ts, p_actor_id, p_actor_role, p_action, p_entity_type, p_entity_id, p_patient_id,
                  coalesce(p_details, '{}'::jsonb), p_request_id, p_ip, v_prev,
                  encode(digest(audit_hash_input(v_prev, v_ts, p_actor_id, p_actor_role, p_action, p_entity_type,
                                                 p_entity_id, p_patient_id, coalesce(p_details, '{}'::jsonb)),
                                'sha256'), 'hex'))
          RETURNING id INTO v_id;
          RETURN v_id;
        END $$;

        CREATE OR REPLACE FUNCTION audit_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
        END $$;
        CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
          FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
        CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_log
          FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM oralscreen_app;
        GRANT EXECUTE ON FUNCTION audit_append(text, text, text, text, text, text, jsonb, text, text) TO oralscreen_app;
    """)

    # ── Row-level security on every table holding patient data ──
    op.execute("""
        ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
        ALTER TABLE patients FORCE ROW LEVEL SECURITY;
        CREATE POLICY p_patients ON patients
          USING (
            app_privileged()
            OR (app_role() IN ('asha', 'nurse') AND facility_id::text = app_facility())
            OR (app_role() = 'specialist' AND (
                  EXISTS (SELECT 1 FROM referrals r WHERE r.patient_id = patients.id
                                                       AND r.facility_id::text = app_facility())
               OR EXISTS (SELECT 1 FROM review_tasks t WHERE t.patient_id = patients.id
                                                         AND t.facility_id::text = app_facility())))
            OR (app_role() = 'provider' AND id::text = app_patient_scope())
          )
          WITH CHECK (app_privileged() OR (app_role() IN ('asha', 'nurse') AND facility_id::text = app_facility()));

        ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
        ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
        CREATE POLICY p_referrals ON referrals
          USING (app_privileged()
                 OR facility_id::text = app_facility()
                 OR from_facility_id::text = app_facility()
                 OR (app_role() = 'provider' AND patient_id::text = app_patient_scope()));

        ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;
        ALTER TABLE review_tasks FORCE ROW LEVEL SECURITY;
        CREATE POLICY p_tasks ON review_tasks
          USING (app_privileged() OR (app_role() = 'specialist' AND facility_id::text = app_facility()));
    """)
    for t in PHI_PATIENT_TABLES:
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
            CREATE POLICY p_{t} ON {t}
              USING (app_privileged() OR EXISTS (SELECT 1 FROM patients p WHERE p.id = {t}.patient_id));
        """)
    for t in PHI_SCREENING_TABLES:
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
            CREATE POLICY p_{t} ON {t}
              USING (app_privileged() OR EXISTS (SELECT 1 FROM screenings s WHERE s.id = {t}.screening_id));
        """)
    for t in PHI_IMAGE_TABLES:
        op.execute(f"""
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
            CREATE POLICY p_{t} ON {t}
              USING (app_privileged() OR EXISTS (SELECT 1 FROM screening_images i WHERE i.id = {t}.image_id));
        """)


def downgrade() -> None:
    for t in PHI_PATIENT_TABLES + PHI_SCREENING_TABLES + PHI_IMAGE_TABLES + ["patients", "referrals", "review_tasks"]:
        op.execute(f"DROP POLICY IF EXISTS p_{t if t != 'review_tasks' else 'tasks'} ON {t}; "
                   f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY;")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
        DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
        DROP FUNCTION IF EXISTS audit_append(text, text, text, text, text, text, jsonb, text, text);
        DROP FUNCTION IF EXISTS audit_block_mutation();
        DROP FUNCTION IF EXISTS audit_hash_input(text, timestamptz, text, text, text, text, text, text, jsonb);
        DROP FUNCTION IF EXISTS app_privileged(); DROP FUNCTION IF EXISTS app_role();
        DROP FUNCTION IF EXISTS app_facility(); DROP FUNCTION IF EXISTS app_user();
        DROP FUNCTION IF EXISTS app_patient_scope();
        ALTER TABLE screenings DROP COLUMN IF EXISTS geom;
        ALTER TABLE villages DROP COLUMN IF EXISTS geom;
        ALTER TABLE facilities DROP COLUMN IF EXISTS geom;
    """)
