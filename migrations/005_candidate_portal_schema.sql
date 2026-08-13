-- 005_candidate_portal_schema.sql: Candidate Portal & Single-Time CV Embedding Schema

-- 1. Candidate Users Table
CREATE TABLE IF NOT EXISTS candidate_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash CHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_users_email ON candidate_users (email);

-- 2. Candidate Profiles Table (CV parsed data & single-time generated embedding)
CREATE TABLE IF NOT EXISTS candidate_profiles (
    candidate_id INT PRIMARY KEY REFERENCES candidate_users(id) ON DELETE CASCADE,
    university VARCHAR(255),
    gpa NUMERIC(3, 2),
    current_class INT NOT NULL DEFAULT 5,
    experience_years INT NOT NULL DEFAULT 0,
    skills TEXT[] NOT NULL DEFAULT '{}',
    raw_cv_text TEXT NOT NULL DEFAULT '',
    cv_embedding VECTOR(1024),
    source_path TEXT,
    fts tsvector,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_gpa ON candidate_profiles (gpa);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_class ON candidate_profiles (current_class);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_embedding ON candidate_profiles USING ivfflat (cv_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_fts ON candidate_profiles USING GIN (fts);

-- Trigger for candidate_profiles fts auto update
CREATE OR REPLACE FUNCTION candidate_profiles_trigger_fts() RETURNS trigger AS $$
begin
  new.fts := to_tsvector('english', coalesce(new.university, '') || ' ' || coalesce(new.raw_cv_text, '') || ' ' || array_to_string(new.skills, ' '));
  return new;
end
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidate_profiles_fts ON candidate_profiles;
CREATE TRIGGER trg_candidate_profiles_fts
BEFORE INSERT OR UPDATE ON candidate_profiles
FOR EACH ROW EXECUTE FUNCTION candidate_profiles_trigger_fts();

-- 3. Job Applications Table (relates job postings with candidates, zero embedding overhead)
CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY,
    job_posting_id INT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidate_users(id) ON DELETE CASCADE,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'applied',
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_job_candidate_application UNIQUE (job_posting_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_job_applications_posting ON job_applications (job_posting_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_candidate ON job_applications (candidate_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_org ON job_applications (organization_id);

-- 4. Debate Results update (link to job_applications)
ALTER TABLE debate_results
ADD COLUMN IF NOT EXISTS application_id INT REFERENCES job_applications(id) ON DELETE CASCADE;
