-- Migration 022: Add Episode Comments System
-- Allows users to comment on episodes with upvote/downvote functionality
-- Comments are sorted by score (upvotes - downvotes) and creation time

-- ==================== EPISODE COMMENTS TABLE ====================
CREATE TABLE IF NOT EXISTS episode_comments (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  
  -- Comment content
  text TEXT NOT NULL,                               -- Comment text content
  
  -- Voting scores (denormalized for performance)
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,                  -- upvotes - downvotes, updated via triggers/API
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  -- Constraints
  CHECK(LENGTH(text) > 0 AND LENGTH(text) <= 5000) -- Max 5000 characters
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_episode_comments_episode ON episode_comments(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_comments_user ON episode_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_episode_comments_content ON episode_comments(content_item_id);
CREATE INDEX IF NOT EXISTS idx_episode_comments_score ON episode_comments(episode_id, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episode_comments_created ON episode_comments(episode_id, created_at DESC);

-- ==================== EPISODE COMMENT VOTES TABLE ====================
-- Track individual user votes on comments (upvote/downvote)
CREATE TABLE IF NOT EXISTS episode_comment_votes (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES episode_comments(id) ON DELETE CASCADE,
  
  -- Vote type: 1 = upvote, -1 = downvote
  vote_type INTEGER NOT NULL CHECK(vote_type IN (1, -1)),
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  -- One vote per user per comment
  UNIQUE(user_id, comment_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_comment_votes_comment ON episode_comment_votes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_votes_user ON episode_comment_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_votes_user_comment ON episode_comment_votes(user_id, comment_id);

-- ==================== UPDATE SCORE TRIGGER ====================
-- Note: D1 doesn't support triggers, so we'll update scores in the API
-- This is a reference for what the score calculation should be:
-- score = upvotes - downvotes
-- We'll maintain this in the API layer when votes are added/removed

