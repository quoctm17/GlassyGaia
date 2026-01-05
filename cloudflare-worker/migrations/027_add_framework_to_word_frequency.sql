-- Migration 027: Add framework column to reference_word_frequency for multi-framework support
-- Adds framework column to support CEFR, JLPT, HSK and other frameworks
-- SAFE: Adds column with default value, then updates existing rows

-- Add framework column (default to NULL for backward compatibility - word frequency can be language-agnostic)
ALTER TABLE reference_word_frequency ADD COLUMN framework TEXT;

-- Create index for framework + word lookups
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_framework_word ON reference_word_frequency(framework, word);

