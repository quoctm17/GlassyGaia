-- Migration 051: Populate search_terms table (No-op)
-- Note: This migration is a no-op because populating the table via SQL
-- causes D1 timeouts on large databases.
--
-- Instead, use the API endpoints to populate the tables:
-- 1. POST /api/admin/populate-search-terms - Populates search_terms table
-- 2. POST /api/admin/populate-search-words - Populates search_words table
--
-- These endpoints process data in smaller batches to avoid timeouts.
-- Run them sequentially - first search_terms, then search_words.

SELECT 1; -- No-op migration

-- Note: After applying this migration:
-- 1. Run: curl -X POST https://glassygaia-worker.your-domain.workers.dev/api/admin/populate-search-terms
-- 2. Then run: curl -X POST https://glassygaia-worker.your-domain.workers.dev/api/admin/populate-search-words
-- Both endpoints require SuperAdmin authentication.
