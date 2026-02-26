-- Migration 053: Drop unused search_terms table
-- Autocomplete now uses search_words table exclusively.
-- The search_terms table (phrase-level) is no longer queried by any endpoint.

DROP TABLE IF EXISTS search_terms;
