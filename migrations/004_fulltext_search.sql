-- 004_fulltext_search.sql: Add Full-Text Search (tsvector) capabilities to Supabase PostgreSQL database

ALTER TABLE candidates 
ADD COLUMN IF NOT EXISTS fts tsvector;

-- Populate tsvector column using english / simple text search configuration
UPDATE candidates 
SET fts = to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(university, '') || ' ' || coalesce(raw_cv_text, '') || ' ' || array_to_string(skills, ' '));

-- Create GIN Index for fast full-text search matching
CREATE INDEX IF NOT EXISTS idx_candidates_fts ON candidates USING GIN (fts);

-- Trigger function to automatically update fts column on candidate INSERT or UPDATE
CREATE OR REPLACE FUNCTION candidates_trigger_fts() RETURNS trigger AS $$
begin
  new.fts := to_tsvector('english', coalesce(new.full_name, '') || ' ' || coalesce(new.university, '') || ' ' || coalesce(new.raw_cv_text, '') || ' ' || array_to_string(new.skills, ' '));
  return new;
end
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidates_fts ON candidates;
CREATE TRIGGER trg_candidates_fts
BEFORE INSERT OR UPDATE ON candidates
FOR EACH ROW EXECUTE FUNCTION candidates_trigger_fts();
