-- 013_nim_1024_embeddings.sql: Switch pgvector embedding columns to 1024-dim
-- (NVIDIA NIM nvidia/nemotron-3.5-embed-1b Matryoshka 1024d).
-- Idempotent: only alters columns whose current type is not already vector(1024),
-- clearing incompatible vectors and rebuilding ivfflat indexes cleanly.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'candidates'
          AND a.attname = 'cv_embedding'
          AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) <> 'vector(1024)'
    ) THEN
        DROP INDEX IF EXISTS idx_candidates_embedding;
        UPDATE candidates SET cv_embedding = NULL WHERE cv_embedding IS NOT NULL;
        ALTER TABLE candidates ALTER COLUMN cv_embedding TYPE VECTOR(1024);
        CREATE INDEX idx_candidates_embedding
            ON candidates USING ivfflat (cv_embedding vector_cosine_ops)
            WITH (lists = 100);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'candidate_profiles'
          AND a.attname = 'cv_embedding'
          AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) <> 'vector(1024)'
    ) THEN
        DROP INDEX IF EXISTS idx_candidate_profiles_embedding;
        UPDATE candidate_profiles SET cv_embedding = NULL WHERE cv_embedding IS NOT NULL;
        ALTER TABLE candidate_profiles ALTER COLUMN cv_embedding TYPE VECTOR(1024);
        CREATE INDEX idx_candidate_profiles_embedding
            ON candidate_profiles USING ivfflat (cv_embedding vector_cosine_ops)
            WITH (lists = 100);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'job_postings'
          AND a.attname = 'description_embedding'
          AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) <> 'vector(1024)'
    ) THEN
        UPDATE job_postings SET description_embedding = NULL WHERE description_embedding IS NOT NULL;
        ALTER TABLE job_postings ALTER COLUMN description_embedding TYPE VECTOR(1024);
    END IF;
END $$;
