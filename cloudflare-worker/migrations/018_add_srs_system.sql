-- Migration 018: Add SRS (Spaced Repetition System) and Gamification
-- Adds card state tracking, review system, and score system (Streak, XP, Coin)

-- ==================== DROP OLD FAVORITES TABLE ====================
-- user_card_states replaces user_favorites for card saving
DROP TABLE IF EXISTS user_favorites;

-- ==================== USER CARD STATE TABLE ====================
-- Track SRS state for each card per user
CREATE TABLE IF NOT EXISTS user_card_states (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  
  -- Card location (denormalized for quick filtering)
  film_id TEXT,
  episode_id TEXT,
  
  -- SRS State: 'none', 'new', 'again', 'hard', 'good', 'easy'
  srs_state TEXT NOT NULL DEFAULT 'none',
  
  -- Review tracking
  review_count INTEGER NOT NULL DEFAULT 0,        -- Total times user reviewed this card
  srs_count INTEGER NOT NULL DEFAULT 0,           -- SRS repetition count (for interval calculation)
  
  -- SRS Interval (in hours) - calculated from srs_count and base interval
  srs_interval REAL NOT NULL DEFAULT 0,           -- Current interval in hours
  
  -- Next review time (Unix timestamp in milliseconds)
  next_review_at INTEGER,                         -- When this card should be reviewed next
  
  -- Last review time
  last_reviewed_at INTEGER,                       -- When user last reviewed this card
  
  -- State change tracking
  state_created_at INTEGER,                       -- When user first set state for this card (saved it)
  state_updated_at INTEGER,                       -- When user last changed the state
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, card_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_card_states_user ON user_card_states(user_id);
CREATE INDEX IF NOT EXISTS idx_user_card_states_state ON user_card_states(user_id, srs_state);
CREATE INDEX IF NOT EXISTS idx_user_card_states_review ON user_card_states(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_user_card_states_film ON user_card_states(user_id, film_id);

-- ==================== SRS BASE INTERVALS TABLE ====================
-- Define base intervals for each SRS state (can be customized per user later)
CREATE TABLE IF NOT EXISTS srs_base_intervals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  srs_state TEXT NOT NULL UNIQUE,
  base_interval_hours REAL NOT NULL,              -- Base interval in hours
  interval_multiplier REAL NOT NULL DEFAULT 1.0,  -- Multiplier for each srs_count increment
  description TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Insert default SRS intervals
INSERT OR IGNORE INTO srs_base_intervals (srs_state, base_interval_hours, interval_multiplier, description) VALUES
  ('new', 0, 1.0, 'Newly saved card, ready for first review'),
  ('again', 1, 1.0, 'Failed review, repeat in 1 hour'),
  ('hard', 6, 1.5, 'Difficult card, repeat in 6 hours'),
  ('good', 24, 2.0, 'Normal progress, repeat in 1 day'),
  ('easy', 48, 2.5, 'Easy card, repeat in 2 days');

-- ==================== USER SCORES TABLE ====================
-- Track current gamification state (aggregated totals only)
CREATE TABLE IF NOT EXISTS user_scores (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- Streak tracking (current state)
  current_streak INTEGER NOT NULL DEFAULT 0,        -- Current consecutive days of study
  longest_streak INTEGER NOT NULL DEFAULT 0,        -- All-time longest streak
  last_study_date TEXT,                            -- YYYY-MM-DD format, for streak calculation
  
  -- XP (Experience Points) - lifetime totals
  total_xp INTEGER NOT NULL DEFAULT 0,              -- Lifetime XP earned
  
  -- Coins (virtual currency) - current state
  coins INTEGER NOT NULL DEFAULT 0,                 -- Current coin balance
  total_coins_earned INTEGER NOT NULL DEFAULT 0,    -- Lifetime coins earned
  
  -- Level (derived from XP, stored for quick access)
  level INTEGER NOT NULL DEFAULT 1,
  
  -- Activity tracking (lifetime totals in seconds)
  total_listening_time INTEGER NOT NULL DEFAULT 0,  -- Total listening time in seconds
  total_reading_time INTEGER NOT NULL DEFAULT 0,    -- Total reading time in seconds
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_user_scores_xp ON user_scores(total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_streak ON user_scores(current_streak DESC);

-- ==================== USER DAILY ACTIVITY TABLE ====================
-- Track daily activity that resets each day (for XP calculation and daily tracking)
CREATE TABLE IF NOT EXISTS user_daily_activity (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date TEXT NOT NULL,                      -- YYYY-MM-DD
  
  -- Daily XP tracking (reset daily)
  daily_xp INTEGER NOT NULL DEFAULT 0,              -- XP earned today
  
  -- Daily activity tracking (reset daily, in seconds)
  daily_listening_time INTEGER NOT NULL DEFAULT 0,  -- Today's listening time
  daily_reading_time INTEGER NOT NULL DEFAULT 0,   -- Today's reading time
  
  -- XP checkpoint tracking (seconds already converted to XP)
  daily_listening_checkpoint INTEGER NOT NULL DEFAULT 0,  -- Seconds already converted to XP (listening)
  daily_reading_checkpoint INTEGER NOT NULL DEFAULT 0,    -- Seconds already converted to XP (reading)
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_user ON user_daily_activity(user_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_date ON user_daily_activity(activity_date);

-- ==================== USER STREAK HISTORY TABLE ====================
-- Track daily streak status only (1 record per user per day)
CREATE TABLE IF NOT EXISTS user_streak_history (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streak_date TEXT NOT NULL,                        -- YYYY-MM-DD
  
  -- Streak status
  streak_achieved INTEGER NOT NULL DEFAULT 0,       -- 1 = achieved, 0 = missed (broke streak)
  streak_count INTEGER NOT NULL DEFAULT 0,          -- Streak count on this day
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, streak_date)
);

CREATE INDEX IF NOT EXISTS idx_streak_history_user ON user_streak_history(user_id, streak_date);
CREATE INDEX IF NOT EXISTS idx_streak_history_date ON user_streak_history(streak_date);

-- ==================== USER DAILY STATS TABLE ====================
-- Track daily statistics (historical record, never reset)
CREATE TABLE IF NOT EXISTS user_daily_stats (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stats_date TEXT NOT NULL,                         -- YYYY-MM-DD
  
  -- Daily statistics (historical record)
  cards_reviewed INTEGER NOT NULL DEFAULT 0,        -- Cards reviewed that day
  xp_earned INTEGER NOT NULL DEFAULT 0,             -- XP earned that day
  listening_time INTEGER NOT NULL DEFAULT 0,        -- Listening time that day (seconds)
  reading_time INTEGER NOT NULL DEFAULT 0,           -- Reading time that day (seconds)
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, stats_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_stats_user ON user_daily_stats(user_id, stats_date);
CREATE INDEX IF NOT EXISTS idx_user_daily_stats_date ON user_daily_stats(stats_date);

-- ==================== REWARDS CONFIG TABLE ====================
-- Define XP and Coin rewards for different actions
CREATE TABLE IF NOT EXISTS rewards_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL DEFAULT 'action',      -- 'action', 'challenge', 'achievement'
  xp_amount INTEGER NOT NULL DEFAULT 0,             -- XP reward
  coin_amount INTEGER NOT NULL DEFAULT 0,          -- Coin reward
  is_repeatable INTEGER NOT NULL DEFAULT 1,        -- 1 = can claim multiple times, 0 = once only
  cooldown_seconds INTEGER,                         -- Cooldown between claims (NULL = no cooldown)
  description TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Insert default rewards config
INSERT OR IGNORE INTO rewards_config (action_type, reward_type, xp_amount, coin_amount, is_repeatable, description) VALUES
  ('daily_challenge', 'challenge', 20, 20, 0, 'Complete daily challenge (once per day)'),
  ('weekly_challenge', 'challenge', 50, 50, 0, 'Complete weekly challenge (once per week)'),
  ('srs_state_change', 'action', 1, 0, 1, 'Change SRS state of a card'),
  ('listening_5s', 'action', 1, 0, 1, 'Every 5 seconds of listening'),
  ('reading_8s', 'action', 1, 0, 1, 'Every 8 seconds of reading');

-- ==================== XP TRANSACTIONS TABLE ====================
-- Track XP earning history for transparency
CREATE TABLE IF NOT EXISTS xp_transactions (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_config_id INTEGER REFERENCES rewards_config(id),  -- FK to rewards_config
  
  -- XP details
  xp_amount INTEGER NOT NULL,                     -- Amount of XP earned
  
  -- Context (optional)
  card_id TEXT,
  film_id TEXT,
  description TEXT,
  
  -- Timestamp
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_xp_transactions_user ON xp_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_date ON xp_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_reward ON xp_transactions(reward_config_id);

-- ==================== COIN TRANSACTIONS TABLE ====================
-- Track coin earning/spending history
CREATE TABLE IF NOT EXISTS coin_transactions (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_config_id INTEGER REFERENCES rewards_config(id),  -- FK to rewards_config (for earning)
  
  -- Coin details
  coin_amount INTEGER NOT NULL,                   -- Amount (positive = earned, negative = spent)
  transaction_type TEXT NOT NULL,                 -- 'earn', 'spend'
  
  -- Context
  description TEXT,
  
  -- Timestamp
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_reward ON coin_transactions(reward_config_id);

-- ==================== CHALLENGE TYPES TABLE ====================
-- Define types of challenges (daily, weekly, achievement, event, etc.)
CREATE TABLE IF NOT EXISTS challenge_types (
  id TEXT PRIMARY KEY,                              -- UUID
  type_name TEXT NOT NULL UNIQUE,                   -- 'daily', 'weekly', 'achievement', 'event'
  description TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Insert default challenge types (using UUIDs)
-- Note: In production, generate proper UUIDs. These are placeholders.
INSERT OR IGNORE INTO challenge_types (id, type_name, description) VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'daily', 'Daily challenges that reset every day'),
  ('550e8400-e29b-41d4-a716-446655440001', 'weekly', 'Weekly challenges that reset every week'),
  ('550e8400-e29b-41d4-a716-446655440002', 'achievement', 'One-time achievements'),
  ('550e8400-e29b-41d4-a716-446655440003', 'event', 'Special event challenges');

-- ==================== CHALLENGES TABLE (Generic) ====================
-- Generic challenges table supporting all challenge types
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,                              -- UUID
  challenge_type_id TEXT NOT NULL REFERENCES challenge_types(id) ON DELETE CASCADE,
  reward_config_id INTEGER NOT NULL REFERENCES rewards_config(id),  -- FK to rewards_config
  
  -- Challenge definition
  title TEXT NOT NULL,                               -- e.g., "Monday Motivation", "Week Warrior"
  description TEXT,                                  -- Challenge description
  
  -- Date range (for daily/weekly challenges)
  start_date TEXT,                                   -- YYYY-MM-DD (NULL = no start date)
  end_date TEXT,                                     -- YYYY-MM-DD (NULL = no end date)
  
  -- Tasks: JSON array of task objects
  -- Example: [{"type": "review_cards", "target": 10}, {"type": "earn_xp", "target": 50}, {"type": "listening_time", "target": 300}]
  -- Task types: review_cards, earn_xp, listening_time, reading_time, save_cards
  tasks TEXT NOT NULL,
  
  -- Reward overrides (optional, NULL = use rewards_config values)
  xp_reward_override INTEGER,                        -- NULL = use rewards_config.xp_amount
  coin_reward_override INTEGER,                      -- NULL = use rewards_config.coin_amount
  
  -- Status
  is_active INTEGER NOT NULL DEFAULT 1,              -- 1 = active, 0 = inactive
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_challenges_type ON challenges(challenge_type_id);
CREATE INDEX IF NOT EXISTS idx_challenges_date ON challenges(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(is_active);
CREATE INDEX IF NOT EXISTS idx_challenges_reward ON challenges(reward_config_id);

-- ==================== USER CHALLENGE PROGRESS TABLE (Generic) ====================
-- Track user progress on all types of challenges
CREATE TABLE IF NOT EXISTS user_challenge_progress (
  id TEXT PRIMARY KEY,                              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  
  -- Progress: JSON object matching tasks structure
  -- Example: {"review_cards": 8, "earn_xp": 45, "listening_time": 250}
  progress TEXT NOT NULL DEFAULT '{}',
  
  -- Completion status
  completed INTEGER NOT NULL DEFAULT 0,              -- 1 = all tasks completed
  completed_at INTEGER,                              -- Timestamp when completed
  reward_claimed INTEGER NOT NULL DEFAULT 0,         -- 1 = reward already claimed
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_user ON user_challenge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_challenge ON user_challenge_progress(challenge_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_completed ON user_challenge_progress(user_id, completed);

-- ==================== VIEW: User Card Review Queue ====================
-- Cards due for review (next_review_at <= now)
CREATE VIEW IF NOT EXISTS v_user_review_queue AS
SELECT 
  ucs.*,
  c.start_time,
  c.end_time,
  c.image_key,
  c.audio_key
FROM user_card_states ucs
JOIN cards c ON ucs.card_id = c.id
WHERE ucs.srs_state != 'none'
  AND (ucs.next_review_at IS NULL OR ucs.next_review_at <= (unixepoch() * 1000))
ORDER BY 
  CASE ucs.srs_state
    WHEN 'new' THEN 1
    WHEN 'again' THEN 2
    WHEN 'hard' THEN 3
    WHEN 'good' THEN 4
    WHEN 'easy' THEN 5
    ELSE 6
  END,
  ucs.next_review_at ASC;

