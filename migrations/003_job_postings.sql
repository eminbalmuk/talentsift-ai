CREATE TABLE IF NOT EXISTS job_postings (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    deadline_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_postings_org ON job_postings (organization_id);

ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS job_posting_id INT REFERENCES job_postings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_candidates_posting ON candidates (job_posting_id);
