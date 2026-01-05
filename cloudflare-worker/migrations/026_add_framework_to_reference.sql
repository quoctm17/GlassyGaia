-- Migration 026: Add framework column to reference_cefr_list for multi-framework support
-- Adds framework column to support CEFR, JLPT, HSK and other frameworks
-- SAFE: Adds column with default value, then updates existing rows

-- Add framework column (default to 'CEFR' for backward compatibility)
ALTER TABLE reference_cefr_list ADD COLUMN framework TEXT DEFAULT 'CEFR';

-- Update existing rows to have framework = 'CEFR'
UPDATE reference_cefr_list SET framework = 'CEFR' WHERE framework IS NULL;

-- Create index for framework + headword lookups
CREATE INDEX IF NOT EXISTS idx_reference_cefr_list_framework_headword ON reference_cefr_list(framework, headword);

