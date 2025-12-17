-- Migration 018: Add SRS (Spaced Repetition System) and Gamification
-- Adds card state tracking, review system, and score system (Streak, XP, Coin)

-- ==================== DROP OLD FAVORITES TABLE ====================
-- user_card_states replaces user_favorites for card saving
DROP TABLE IF EXISTS user_favorites;

-- ==================== USER CARD STATE TABLE ====================
-- Track SRS state for each card per user
CREATE TABLE IF NOT EXISTS user_card_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
-- Track gamification scores: Streak, XP, Coins
CREATE TABLE IF NOT EXISTS user_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- Streak tracking
  current_streak INTEGER NOT NULL DEFAULT 0,      -- Current consecutive days of study
  longest_streak INTEGER NOT NULL DEFAULT 0,      -- All-time longest streak
  last_study_date TEXT,                           -- YYYY-MM-DD format, for streak calculation
  
  -- XP (Experience Points)
  total_xp INTEGER NOT NULL DEFAULT 0,            -- Lifetime XP earned
  weekly_xp INTEGER NOT NULL DEFAULT 0,           -- XP earned this week (reset weekly)
  daily_xp INTEGER NOT NULL DEFAULT 0,            -- XP earned today (reset daily)
  
  -- Coins (virtual currency)
  coins INTEGER NOT NULL DEFAULT 0,               -- Current coin balance
  total_coins_earned INTEGER NOT NULL DEFAULT 0,  -- Lifetime coins earned
  
  -- Level (derived from XP, stored for quick access)
  level INTEGER NOT NULL DEFAULT 1,
  
  -- Activity tracking (in seconds)
  total_listening_time INTEGER NOT NULL DEFAULT 0,  -- Total listening time in seconds
  total_reading_time INTEGER NOT NULL DEFAULT 0,    -- Total reading time in seconds
  daily_listening_time INTEGER NOT NULL DEFAULT 0,  -- Today's listening time (reset daily)
  daily_reading_time INTEGER NOT NULL DEFAULT 0,    -- Today's reading time (reset daily)
  
  -- XP checkpoint tracking (seconds already converted to XP)
  daily_listening_checkpoint INTEGER NOT NULL DEFAULT 0,  -- Seconds already converted to XP (listening)
  daily_reading_checkpoint INTEGER NOT NULL DEFAULT 0,    -- Seconds already converted to XP (reading)
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_user_scores_xp ON user_scores(total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_streak ON user_scores(current_streak DESC);

-- ==================== STREAK HISTORY TABLE ====================
-- Track daily streak status for history and analytics
CREATE TABLE IF NOT EXISTS user_streak_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Date and status
  streak_date TEXT NOT NULL,                      -- YYYY-MM-DD
  streak_achieved INTEGER NOT NULL DEFAULT 0,     -- 1 = achieved, 0 = missed (broke streak)
  streak_count INTEGER NOT NULL DEFAULT 0,        -- Streak count on this day
  
  -- Activity that day
  cards_reviewed INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  listening_time INTEGER NOT NULL DEFAULT 0,      -- Seconds
  reading_time INTEGER NOT NULL DEFAULT 0,        -- Seconds
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, streak_date)
);

CREATE INDEX IF NOT EXISTS idx_streak_history_user ON user_streak_history(user_id, streak_date);

-- ==================== REWARDS CONFIG TABLE ====================
-- Define XP and Coin rewards for different actions
CREATE TABLE IF NOT EXISTS rewards_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL UNIQUE,
  xp_amount INTEGER NOT NULL DEFAULT 0,           -- XP reward
  coin_amount INTEGER NOT NULL DEFAULT 0,         -- Coin reward
  description TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Insert default rewards config
INSERT OR IGNORE INTO rewards_config (action_type, xp_amount, coin_amount, description) VALUES
  ('daily_challenge', 20, 20, 'Complete daily challenge'),
  ('srs_state_change', 1, 0, 'Change SRS state of a card'),
  ('listening_5s', 1, 0, 'Every 5 seconds of listening'),
  ('reading_8s', 1, 0, 'Every 8 seconds of reading');

-- ==================== XP TRANSACTIONS TABLE ====================
-- Track XP earning history for transparency
CREATE TABLE IF NOT EXISTS xp_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- ==================== DAILY GOALS TABLE ====================
-- Track daily learning goals per user
CREATE TABLE IF NOT EXISTS user_daily_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Goal settings
  daily_card_goal INTEGER NOT NULL DEFAULT 10,    -- Number of cards to review per day
  daily_xp_goal INTEGER NOT NULL DEFAULT 50,      -- XP to earn per day
  
  -- Today's progress
  cards_today INTEGER NOT NULL DEFAULT 0,
  xp_today INTEGER NOT NULL DEFAULT 0,
  goal_date TEXT NOT NULL,                        -- YYYY-MM-DD
  goal_completed INTEGER NOT NULL DEFAULT 0,      -- 1 if daily goal was met
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, goal_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_goals_user ON user_daily_goals(user_id, goal_date);

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

