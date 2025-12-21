-- Migration 020: Add video_has_images column to content_items
-- This field indicates whether video content has individual card images (1) or uses episode cover for all cards (0)
-- Default is 1 (has individual images) for backward compatibility

ALTER TABLE content_items ADD COLUMN video_has_images INTEGER DEFAULT 1;
-- 1 = has individual card images (default, backward compatible)
-- 0 = uses episode cover for all cards

-- Update existing video content to default to 1 (has images)
-- This assumes existing video content has individual card images
UPDATE content_items SET video_has_images = 1 WHERE type = 'video' AND video_has_images IS NULL;

