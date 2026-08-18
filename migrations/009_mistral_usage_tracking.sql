-- 009_mistral_usage_tracking.sql: log every Mistral API call so the admin panel can show
-- real usage against the account's rate limits (calls, tokens, errors, per model).

CREATE TABLE IF NOT EXISTS mistral_api_usage (
    id SERIAL PRIMARY KEY,
    model VARCHAR(100) NOT NULL,
    endpoint VARCHAR(50) NOT NULL,
    organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mistral_api_usage_created ON mistral_api_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mistral_api_usage_model_created
    ON mistral_api_usage (model, created_at DESC);
