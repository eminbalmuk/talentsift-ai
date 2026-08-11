CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(160) NOT NULL,
    username_normalized VARCHAR(160) NOT NULL UNIQUE,
    password_hash CHAR(64) NOT NULL UNIQUE,
    password_prefix VARCHAR(32) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    license_key_hash CHAR(64) UNIQUE,
    license_key_prefix VARCHAR(32),
    license_status VARCHAR(32) NOT NULL DEFAULT 'active',
    license_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    license_expires_at TIMESTAMP,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_users (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    username VARCHAR(160) NOT NULL,
    username_normalized VARCHAR(160) NOT NULL UNIQUE,
    password_hash CHAR(64) NOT NULL UNIQUE,
    password_prefix VARCHAR(32) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organization_users_org
    ON organization_users (organization_id);

CREATE TABLE IF NOT EXISTS candidates (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    university VARCHAR(255),
    gpa NUMERIC(3, 2),
    current_class INT NOT NULL,
    experience_years INT NOT NULL DEFAULT 0,
    skills TEXT[] NOT NULL DEFAULT '{}',
    raw_cv_text TEXT NOT NULL,
    cv_embedding VECTOR(1024),
    source_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidates_org_gpa ON candidates (organization_id, gpa);
CREATE INDEX IF NOT EXISTS idx_candidates_org_current_class
    ON candidates (organization_id, current_class);
CREATE INDEX IF NOT EXISTS idx_candidates_embedding
    ON candidates USING ivfflat (cv_embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE TABLE IF NOT EXISTS debate_results (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    optimist_score INT NOT NULL,
    optimist_arguments TEXT NOT NULL,
    pessimist_score INT NOT NULL,
    pessimist_arguments TEXT NOT NULL,
    final_score NUMERIC(5, 2) NOT NULL,
    arbitrator_rationale TEXT NOT NULL,
    is_selected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_debate_results_org_score
    ON debate_results (organization_id, final_score DESC);
