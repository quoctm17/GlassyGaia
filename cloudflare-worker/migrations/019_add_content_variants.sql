-- Migration 019: Add Content Variants Support
-- Allows one original content_item to have multiple variants (e.g., different language dubs)
-- Uses direct foreign key: parent_content_item_id references the original content_item
-- Relationship: 1-N (one original can have many variants, but each variant has only one parent)

-- Add parent_content_item_id column to content_items
-- NULL = original content, NOT NULL = variant pointing to parent
ALTER TABLE content_items ADD COLUMN parent_content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL;

-- Index for efficient variant queries (finding all variants of a parent)
CREATE INDEX IF NOT EXISTS idx_content_items_parent ON content_items(parent_content_item_id);

-- Index for finding original content items (where parent is NULL)
-- This helps quickly identify which content items are originals vs variants
CREATE INDEX IF NOT EXISTS idx_content_items_original ON content_items(parent_content_item_id) WHERE parent_content_item_id IS NULL;

-- Note: 
-- - When parent_content_item_id IS NULL, the content_item is an original
-- - When parent_content_item_id IS NOT NULL, the content_item is a variant
-- - ON DELETE SET NULL: If parent is deleted, variants become orphaned (still exist but lose link)
--   Alternative: Use ON DELETE CASCADE if you want variants deleted when parent is deleted
-- - Variants can reuse image_key from parent (same R2 file path), but have different audio_key

