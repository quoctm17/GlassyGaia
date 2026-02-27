import { REWARD_CONFIG_IDS } from '../utils/constants.js';

// Get or create user_scores record
export async function getOrCreateUserScores(env, userId) {
  let scores = await env.DB.prepare(`
    SELECT * FROM user_scores WHERE user_id = ?
  `).bind(userId).first();

  if (!scores) {
    const scoreId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_scores (id, user_id, created_at, updated_at)
      VALUES (?, ?, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(scoreId, userId).run();
    scores = await env.DB.prepare(`
      SELECT * FROM user_scores WHERE user_id = ?
    `).bind(userId).first();
  }

  return scores;
}

// Get or create user_daily_activity record for today
export async function getOrCreateDailyActivity(env, userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let activity = await env.DB.prepare(`
    SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ?
  `).bind(userId, today).first();

  if (!activity) {
    const activityId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_daily_activity (id, user_id, activity_date, created_at, updated_at)
      VALUES (?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(activityId, userId, today).run();
    activity = await env.DB.prepare(`
      SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  }

  return activity;
}

// Get reward config by ID (preferred method)
export async function getRewardConfigById(env, rewardConfigId) {
  return await env.DB.prepare(`
    SELECT * FROM rewards_config WHERE id = ?
  `).bind(rewardConfigId).first();
}

// Get reward config by action_type (backward compatibility)
export async function getRewardConfig(env, actionType) {
  return await env.DB.prepare(`
    SELECT * FROM rewards_config WHERE action_type = ?
  `).bind(actionType).first();
}

// Calculate Production Factor based on speaking_attempt and writing_attempt
// Production Factor = 1 + min(0.28, 0.01 * speaking_attempt + 0.005 * writing_attempt)
export function calculateProductionFactor(speakingAttempt = 0, writingAttempt = 0) {
  const factor = 0.01 * speakingAttempt + 0.005 * writingAttempt;
  return 1 + Math.min(0.28, factor);
}

// Calculate SRS Interval based on state, srs_count, and production factor
// Returns interval in hours
export async function calculateSRSInterval(env, srsState, srsCount, speakingAttempt = 0, writingAttempt = 0) {
  // Get base interval from srs_base_intervals
  const baseInterval = await env.DB.prepare(`
    SELECT base_interval_hours, interval_multiplier 
    FROM srs_base_intervals 
    WHERE srs_state = ?
  `).bind(srsState).first();

  if (!baseInterval) {
    // Default to 0 if state not found
    return 0;
  }

  const baseHours = baseInterval.base_interval_hours || 0;
  const multiplier = baseInterval.interval_multiplier || 1.0;

  // Calculate interval based on state-specific formula
  let intervalHours = 0;

  if (srsState === 'again') {
    // Again -> Base Interval = 1 hrs
    intervalHours = 1;
  } else if (srsState === 'hard') {
    // Hard -> Base Interval = 6 × (1.3 ^ SRS Count) hrs
    intervalHours = 6 * Math.pow(1.3, srsCount);
  } else if (srsState === 'good') {
    // Good -> Base Interval = 24 × (2.0 ^ SRS Count) hours
    intervalHours = 24 * Math.pow(2.0, srsCount);
  } else if (srsState === 'easy') {
    // Easy -> Base Interval = 48 × (2.5 ^ SRS Count) hrs
    intervalHours = 48 * Math.pow(2.5, srsCount);
  } else {
    // 'new' or other states - use base_interval_hours
    intervalHours = baseHours;
  }

  // Apply Production Factor
  const productionFactor = calculateProductionFactor(speakingAttempt, writingAttempt);
  intervalHours = intervalHours * productionFactor;

  return intervalHours;
}

// Determine if srs_count should be incremented based on state transition
// Returns true if srs_count should increment, false otherwise
export function shouldIncrementSRSCount(oldState, newState) {
  // State hierarchy: again < hard < good < easy
  // Note: 'new' and 'none' are not in the hierarchy (they are initial states)
  const stateOrder = { 'again': 0, 'hard': 1, 'good': 2, 'easy': 3 };

  // Only process states that are in the hierarchy (again, hard, good, easy)
  // Ignore 'none' and 'new' states
  if (!stateOrder.hasOwnProperty(oldState) || !stateOrder.hasOwnProperty(newState)) {
    return false;
  }

  const oldOrder = stateOrder[oldState];
  const newOrder = stateOrder[newState];

  // Increment if:
  // 1. Upgrade (again->hard, hard->good, good->easy, etc.)
  // 2. Re-affirm good or easy (good->good, easy->easy)
  if (newOrder > oldOrder) {
    // Upgrade
    return true;
  } else if ((newState === 'good' || newState === 'easy') && newState === oldState) {
    // Re-affirm good or easy
    return true;
  }

  // Don't increment if:
  // - Downgrade (good->hard, easy->good, etc.)
  // - Re-affirm again or hard
  // - Any transition to/from 'none' or 'new'
  return false;
}

// Award XP and record transaction
export async function awardXP(env, userId, xpAmount, rewardConfigId, description, cardId, filmId) {
  if (xpAmount <= 0) return;

  // Get or create user_scores
  await getOrCreateUserScores(env, userId);

  // Update total_xp in user_scores
  await env.DB.prepare(`
    UPDATE user_scores
    SET total_xp = total_xp + ?,
        level = CAST((total_xp + ?) / 100 AS INTEGER) + 1,
        updated_at = unixepoch() * 1000
    WHERE user_id = ?
  `).bind(xpAmount, xpAmount, userId).run();

  // Record XP transaction
  const transactionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO xp_transactions (id, user_id, reward_config_id, xp_amount, card_id, film_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
  `).bind(transactionId, userId, rewardConfigId, xpAmount, cardId || null, filmId || null, description || null).run();

  // Update daily activity
  const today = new Date().toISOString().split('T')[0];
  await getOrCreateDailyActivity(env, userId);
  await env.DB.prepare(`
    UPDATE user_daily_activity
    SET daily_xp = daily_xp + ?,
        updated_at = unixepoch() * 1000
    WHERE user_id = ? AND activity_date = ?
  `).bind(xpAmount, userId, today).run();

  // Update user_daily_stats (historical record) - update xp_earned
  const statsExisting = await env.DB.prepare(`
    SELECT id FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
  `).bind(userId, today).first();

  if (statsExisting) {
    await env.DB.prepare(`
      UPDATE user_daily_stats
      SET xp_earned = xp_earned + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND stats_date = ?
    `).bind(xpAmount, userId, today).run();
  } else {
    // Record doesn't exist, create new one with xp_earned
    // Initialize listening_time and reading_time to 0 in case trackTime hasn't run yet
    const statsId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_daily_stats (id, user_id, stats_date, xp_earned, listening_time, reading_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(statsId, userId, today, xpAmount).run();
  }

  // Check and update daily streak (if daily_xp >= 20)
  await checkAndUpdateStreak(env, userId);
}

// Award coins and record transaction
export async function awardCoins(env, userId, coinAmount, rewardConfigId, description) {
  if (coinAmount <= 0) return;

  // Get or create user_scores
  await getOrCreateUserScores(env, userId);

  // Update coins in user_scores
  await env.DB.prepare(`
    UPDATE user_scores
    SET coins = coins + ?,
        total_coins_earned = total_coins_earned + ?,
        updated_at = unixepoch() * 1000
    WHERE user_id = ?
  `).bind(coinAmount, coinAmount, userId).run();

  // Record coin transaction
  const transactionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO coin_transactions (id, user_id, reward_config_id, coin_amount, transaction_type, description, created_at)
    VALUES (?, ?, ?, ?, 'earn', ?, unixepoch() * 1000)
  `).bind(transactionId, userId, rewardConfigId, coinAmount, description || null).run();
}

// Check and update daily streak (if daily_xp >= 20, increment streak)
export async function checkAndUpdateStreak(env, userId) {
  const today = new Date().toISOString().split('T')[0];
  const activity = await getOrCreateDailyActivity(env, userId);

  // Only update streak if daily_xp >= 20 and we haven't already updated today
  if (activity.daily_xp >= 20) {
    const scores = await getOrCreateUserScores(env, userId);
    const lastStudyDate = scores.last_study_date;

    // Check if this is a new day (streak continuation or new streak)
    if (lastStudyDate !== today) {
      let newStreak = 1;

      if (lastStudyDate) {
        // Check if yesterday was studied (streak continuation)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastStudyDate === yesterdayStr) {
          // Continue streak
          newStreak = (scores.current_streak || 0) + 1;
        }
        // Otherwise, new streak (already set to 1)
      }

      // Update streak
      const longestStreak = Math.max(scores.longest_streak || 0, newStreak);
      await env.DB.prepare(`
        UPDATE user_scores
        SET current_streak = ?,
            longest_streak = ?,
            last_study_date = ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ?
      `).bind(newStreak, longestStreak, today, userId).run();

      // Record streak history
      const historyId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT OR REPLACE INTO user_streak_history (id, user_id, streak_date, streak_achieved, streak_count, created_at)
        VALUES (?, ?, ?, 1, ?, unixepoch() * 1000)
      `).bind(historyId, userId, today, newStreak).run();
    }
  }
}

// Track listening or reading time and award XP based on checkpoints
export async function trackTime(env, userId, timeSeconds, type) {
  if (timeSeconds <= 0) return { xpAwarded: 0 };

  const today = new Date().toISOString().split('T')[0];
  await getOrCreateDailyActivity(env, userId);
  await getOrCreateUserScores(env, userId);

  // Get reward config by ID
  const rewardConfigId = type === 'listening' ? REWARD_CONFIG_IDS.LISTENING_5S : REWARD_CONFIG_IDS.READING_8S;
  const rewardConfig = await getRewardConfigById(env, rewardConfigId);
  if (!rewardConfig) return { xpAwarded: 0 };

  // Use interval_seconds from config, fallback to defaults if not set
  const intervalSeconds = rewardConfig.interval_seconds || (type === 'listening' ? 5 : 8);
  const checkpointField = type === 'listening' ? 'daily_listening_checkpoint' : 'daily_reading_checkpoint';
  const timeField = type === 'listening' ? 'daily_listening_time' : 'daily_reading_time';
  const totalTimeField = type === 'listening' ? 'total_listening_time' : 'total_reading_time';

  // Get current checkpoint - use separate queries for listening vs reading
  let activity;
  if (type === 'listening') {
    activity = await env.DB.prepare(`
      SELECT daily_listening_checkpoint, daily_listening_time FROM user_daily_activity
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  } else {
    activity = await env.DB.prepare(`
      SELECT daily_reading_checkpoint, daily_reading_time FROM user_daily_activity
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  }

  const currentCheckpoint = (type === 'listening' ? activity?.daily_listening_checkpoint : activity?.daily_reading_checkpoint) || 0;
  const currentTime = (type === 'listening' ? activity?.daily_listening_time : activity?.daily_reading_time) || 0;

  // Calculate new total time
  const newTime = currentTime + timeSeconds;

  // Calculate how many intervals we've completed (beyond checkpoint)
  const newCheckpoint = Math.floor(newTime / intervalSeconds) * intervalSeconds;
  const intervalsCompleted = Math.floor((newCheckpoint - currentCheckpoint) / intervalSeconds);

  // Award XP for completed intervals
  let totalXPAwarded = 0;
  if (intervalsCompleted > 0 && rewardConfig.xp_amount > 0) {
    const xpToAward = intervalsCompleted * rewardConfig.xp_amount;
    await awardXP(env, userId, xpToAward, rewardConfig.id, `${type} time tracking`, null, null);
    totalXPAwarded = xpToAward;
  }

  // Update daily activity - use separate queries for listening vs reading
  if (type === 'listening') {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET daily_listening_time = ?,
          daily_listening_checkpoint = ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(newTime, newCheckpoint, userId, today).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET daily_reading_time = ?,
          daily_reading_checkpoint = ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(newTime, newCheckpoint, userId, today).run();
  }

  // Update total time in user_scores
  if (type === 'listening') {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_listening_time = total_listening_time + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(timeSeconds, userId).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_reading_time = total_reading_time + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(timeSeconds, userId).run();
  }

  // Update user_daily_stats (historical record)
  // Note: awardXP() already updated xp_earned above if XP was awarded
  // We just need to update listening_time or reading_time here
  if (type === 'listening') {
    // Use INSERT OR REPLACE to handle case where record might exist from awardXP
    // Or use ON CONFLICT DO UPDATE for better control
    const existing = await env.DB.prepare(`
      SELECT id, xp_earned FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
    `).bind(userId, today).first();

    if (existing) {
      // Record exists (might have been created by awardXP), just update listening_time
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET listening_time = COALESCE(listening_time, 0) + ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(timeSeconds, userId, today).run();
    } else {
      // Record doesn't exist, create new one with listening_time and xp_earned = 0 (or NULL, default will be 0)
      const statsId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, listening_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today, timeSeconds).run();
    }
  } else {
    // Reading time - same logic
    const existing = await env.DB.prepare(`
      SELECT id, xp_earned FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
    `).bind(userId, today).first();

    if (existing) {
      // Record exists (might have been created by awardXP), just update reading_time
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET reading_time = COALESCE(reading_time, 0) + ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(timeSeconds, userId, today).run();
    } else {
      // Record doesn't exist, create new one with reading_time and xp_earned = 0
      const statsId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today, timeSeconds).run();
    }
  }

  return { xpAwarded: totalXPAwarded };
}

// Track speaking or writing attempt and award XP
export async function trackAttempt(env, userId, type, cardId, filmId) {
  // Get reward config by ID
  const rewardConfigId = type === 'speaking' ? REWARD_CONFIG_IDS.SPEAKING_ATTEMPT : REWARD_CONFIG_IDS.WRITING_ATTEMPT;
  const rewardConfig = await getRewardConfigById(env, rewardConfigId);
  if (!rewardConfig) return { xpAwarded: 0 };

  const today = new Date().toISOString().split('T')[0];
  await getOrCreateUserScores(env, userId);
  await getOrCreateDailyActivity(env, userId);

  // Award XP (will handle transaction, daily stats, and streak)
  if (rewardConfig.xp_amount > 0) {
    await awardXP(env, userId, rewardConfig.xp_amount, rewardConfig.id, `${type} attempt`, cardId || null, filmId || null);
  }

  // Update speaking_attempt or writing_attempt in user_card_states if card_id is provided
  if (cardId) {
    if (type === 'speaking') {
      await env.DB.prepare(`
        UPDATE user_card_states
        SET speaking_attempt = speaking_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND card_id = ?
      `).bind(userId, cardId).run();
    } else {
      await env.DB.prepare(`
        UPDATE user_card_states
        SET writing_attempt = writing_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND card_id = ?
      `).bind(userId, cardId).run();
    }
  }

  // Update user_scores (lifetime totals)
  if (type === 'speaking') {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_speaking_attempt = total_speaking_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(userId).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_writing_attempt = total_writing_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(userId).run();
  }

  // Update user_daily_activity (reset daily)
  if (type === 'speaking') {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET speaking_attempt = speaking_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET writing_attempt = writing_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).run();
  }

  // Update user_daily_stats (historical record)
  const statsExisting = await env.DB.prepare(`
    SELECT id FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
  `).bind(userId, today).first();

  if (statsExisting) {
    if (type === 'speaking') {
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET speaking_attempt = speaking_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(userId, today).run();
    } else {
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET writing_attempt = writing_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(userId, today).run();
    }
  } else {
    // Record doesn't exist, create new one
    const statsId = crypto.randomUUID();
    if (type === 'speaking') {
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, speaking_attempt, writing_attempt, listening_time, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, 0, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, speaking_attempt, writing_attempt, listening_time, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, 0, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today).run();
    }
  }

  return { xpAwarded: rewardConfig.xp_amount || 0 };
}
