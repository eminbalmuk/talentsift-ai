-- 010_interview_scheduling.sql: lets an organization propose an interview slot for a
-- "selected" candidate, and the candidate confirm/decline it from their notification feed.

CREATE TABLE IF NOT EXISTS interview_schedules (
    id SERIAL PRIMARY KEY,
    job_posting_id INT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidate_users(id) ON DELETE CASCADE,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    proposed_at TIMESTAMP NOT NULL,
    location_or_link TEXT,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'proposed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_posting_candidate_interview UNIQUE (job_posting_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_schedules_candidate
    ON interview_schedules (candidate_id);

ALTER TABLE candidate_notifications
    ADD COLUMN IF NOT EXISTS interview_schedule_id INT
        REFERENCES interview_schedules(id) ON DELETE SET NULL;
