-- 012_platform_fixes.sql: Auth hardening, timezone safety, and AI explainability columns

-- 1. Drop legacy password_hash UNIQUE constraints and allow salted hash strings
ALTER TABLE admin_users
DROP CONSTRAINT IF EXISTS admin_users_password_hash_key;

ALTER TABLE admin_users
ALTER COLUMN password_hash TYPE TEXT;

ALTER TABLE organization_users
DROP CONSTRAINT IF EXISTS organization_users_password_hash_key;

ALTER TABLE organization_users
ALTER COLUMN password_hash TYPE TEXT;

-- 2. Fix naive TIMESTAMP -> TIMESTAMPTZ on interview_schedules so UTC offsets round-trip safely
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'interview_schedules'
          AND column_name = 'proposed_at'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE interview_schedules
        ALTER COLUMN proposed_at TYPE TIMESTAMPTZ USING proposed_at AT TIME ZONE 'UTC';
    END IF;
END $$;

-- 3. AI explainability & grounding metadata on job_applications and debate_results
ALTER TABLE job_applications
ADD COLUMN IF NOT EXISTS dense_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS sparse_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS bm25_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS tfidf_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS matched_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS missing_skills JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE debate_results
ADD COLUMN IF NOT EXISTS dense_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS sparse_score DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS matched_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS missing_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS evidence_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS grounding_score DOUBLE PRECISION;

-- 4. Use language-agnostic 'simple' tsvector triggers so Turkish words are preserved intact
CREATE OR REPLACE FUNCTION candidates_trigger_fts() RETURNS trigger AS $$
BEGIN
  new.fts := to_tsvector(
    'simple',
    coalesce(new.full_name, '') || ' ' ||
    coalesce(new.university, '') || ' ' ||
    coalesce(new.raw_cv_text, '') || ' ' ||
    array_to_string(coalesce(new.skills, '{}'::text[]), ' ')
  );
  RETURN new;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION candidate_profiles_trigger_fts() RETURNS trigger AS $$
BEGIN
  new.fts := to_tsvector(
    'simple',
    coalesce(new.university, '') || ' ' ||
    coalesce(new.raw_cv_text, '') || ' ' ||
    array_to_string(coalesce(new.skills, '{}'::text[]), ' ')
  );
  RETURN new;
END
$$ LANGUAGE plpgsql;
