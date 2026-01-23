-- Migration 044: Remove reference_cefr_list table - now using only frequency-based assessment
-- The system now uses only reference_word_frequency table with JSON frequency lookup files
-- This simplifies the assessment system to use frequency ranks with framework-specific cutoffs

-- Drop the reference_cefr_list table and its indexes
DROP INDEX IF EXISTS idx_reference_cefr_list_headword;
DROP INDEX IF EXISTS idx_reference_cefr_list_level;
DROP INDEX IF EXISTS idx_reference_cefr_list_framework_headword;
DROP TABLE IF EXISTS reference_cefr_list;

-- Note: reference_word_frequency table remains and will be used for all assessments
-- Frequency data is loaded from JSON files (e.g., en_freq_lookup.json) and stored in this table
