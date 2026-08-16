-- 006_fix_debate_results_candidate_fk.sql
--
-- debate_results.candidate_id has always had a hard FK to candidates(id) (the legacy
-- org-bulk-upload table). Migration 005 introduced the candidate self-service portal
-- (candidate_users/candidate_profiles) as a second, independent ID space, but never
-- updated this FK. repository.get_candidate() already unifies both ID spaces behind
-- one "candidate_id", and both /postings/{id}/debate and /postings/{id}/shortlist
-- insert into debate_results using whichever id that unified lookup returns -- for
-- any portal candidate whose id doesn't happen to collide with a row in the legacy
-- candidates table, saving a debate result fails with a ForeignKeyViolationError.
--
-- Since candidate_id can legitimately point into either table depending on how the
-- candidate was created, and a Postgres FK can only target one table, drop the
-- constraint. Existence is already validated at the application layer: debate_results
-- is only ever inserted right after repository.get_candidate() successfully resolves
-- the same candidate_id.

ALTER TABLE debate_results DROP CONSTRAINT IF EXISTS debate_results_candidate_id_fkey;
