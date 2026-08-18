-- 008_persisted_pre_llm_scores.sql: cache each posting's description embedding (so
-- scoring a candidate never needs a fresh Mistral call) and persist every applicant's
-- pre-LLM score on their application row so it survives a page refresh and can be
-- updated incrementally as new applicants arrive, instead of only existing ephemerally
-- inside a "sırala" response.

ALTER TABLE job_postings
    ADD COLUMN IF NOT EXISTS description_embedding VECTOR(1024);

ALTER TABLE job_applications
    ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS competency_score NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS pre_llm_score NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS score_computed_at TIMESTAMP;
