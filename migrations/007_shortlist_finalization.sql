-- 007_shortlist_finalization.sql: persist pre-LLM scores on debate results, and add
-- candidate-facing notifications so rejections/selections are transparent.

ALTER TABLE debate_results
    ADD COLUMN IF NOT EXISTS job_posting_id INT REFERENCES job_postings(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS pre_llm_score NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS competency_score NUMERIC(6, 4);

CREATE INDEX IF NOT EXISTS idx_debate_results_posting
    ON debate_results (job_posting_id, final_score DESC);

CREATE TABLE IF NOT EXISTS candidate_notifications (
    id SERIAL PRIMARY KEY,
    candidate_id INT NOT NULL REFERENCES candidate_users(id) ON DELETE CASCADE,
    job_posting_id INT REFERENCES job_postings(id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    debate_result_id INT REFERENCES debate_results(id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_candidate
    ON candidate_notifications (candidate_id, created_at DESC);
