-- Migration 015: Remove full_audio_key and full_video_key from episodes table
-- These columns are no longer used as all media files have been deleted

-- Drop the columns
ALTER TABLE episodes DROP COLUMN full_audio_key;
ALTER TABLE episodes DROP COLUMN full_video_key;
