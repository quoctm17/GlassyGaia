-- Migration 039: Rollback main_language_card_index table
-- Drop the materialized index table and its indexes

DROP INDEX IF EXISTS idx_main_lang_card_difficulty;
DROP INDEX IF EXISTS idx_main_lang_card_lang;
DROP TABLE IF EXISTS main_language_card_index;
