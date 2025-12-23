-- Migration 021: Add content likes system
-- Allows users to like content items (movies, series, books, audio)
-- Tracks both user likes and total like counts per content

-- ==================== CONTENT LIKES TABLE ====================
-- Track which users have liked which content items
CREATE TABLE IF NOT EXISTS content_likes (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, content_item_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_content_likes_user ON content_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_content_likes_content ON content_likes(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_likes_user_content ON content_likes(user_id, content_item_id);

-- ==================== CONTENT LIKE COUNTS TABLE ====================
-- Denormalized table to store total like counts per content item for quick access
-- This avoids COUNT(*) queries on content_likes table
CREATE TABLE IF NOT EXISTS content_like_counts (
  content_item_id TEXT PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  like_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Initialize like counts for existing content items
INSERT OR IGNORE INTO content_like_counts (content_item_id, like_count)
SELECT id, 0 FROM content_items;

-- Note: Like counts will be updated manually in the API endpoints
-- Cloudflare D1 doesn't handle triggers well, so we update content_like_counts
-- directly in the worker.js when likes are added/removed

