import { json } from '../utils/response.js';
import { authenticateRequest } from '../middleware/auth.js';
import { getOrCreateUserScores, getRewardConfigById, trackTime, trackAttempt } from '../services/gamification.js';
import { REWARD_CONFIG_IDS } from '../utils/constants.js';

export function registerUserRoutes(router) {
  router.get('/api/user/saved-cards', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = (page - 1) * limit;

      if (!userId) {
        return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
      }

      // Get saved cards with card details
      const cards = await env.DB.prepare(`
        SELECT 
          ucs.card_id,
          ucs.srs_state,
          ucs.film_id,
          ucs.episode_id,
          c.card_number,
          c.start_time,
          c.end_time,
          c.duration,
          c.image_key,
          c.audio_key,
          c.sentence,
          c.card_type,
          c.length,
          c.difficulty_score,
          e.slug as episode_slug,
          e.episode_number,
          ci.slug as film_slug,
          ci.title as film_title,
          c.id as card_db_id,  -- Unique card ID from database
          c.card_number,  -- Card number in episode (for display)
          ucs.state_created_at,
          ucs.state_updated_at,
          ucs.created_at,
          ucs.next_review_at
        FROM user_card_states ucs
        JOIN cards c ON ucs.card_id = c.id
        JOIN episodes e ON c.episode_id = e.id
        JOIN content_items ci ON e.content_item_id = ci.id
        WHERE ucs.user_id = ? AND ucs.srs_state != 'none'
        ORDER BY ucs.state_updated_at DESC
        LIMIT ? OFFSET ?
      `).bind(userId, limit, offset).all();

      // Get total count
      const countResult = await env.DB.prepare(`
        SELECT COUNT(*) as total
        FROM user_card_states
        WHERE user_id = ? AND srs_state != 'none'
      `).bind(userId).first();

      const total = countResult?.total || 0;

      // Format cards similar to CardDoc - load subtitles and XP data for each card
      const formattedCards = await Promise.all((cards.results || []).map(async (row) => {
        const filmSlug = row.film_slug || row.film_id;
        const epSlug = row.episode_slug || row.episode_id;
        const cardDisplayId = String(row.card_number || '').padStart(3, '0');

        // Load subtitles for this card
        const cardDbId = row.card_db_id || row.card_id; // Use card_db_id (unique ID) if available
        const subs = await env.DB.prepare(`
          SELECT language, text FROM card_subtitles WHERE card_id = ?
        `).bind(cardDbId).all();

        const subtitle = {};
        (subs.results || []).forEach((s) => {
          subtitle[s.language] = s.text;
        });

        // Calculate XP for this card by reward config ID
        const xpData = await env.DB.prepare(`
          SELECT 
            xt.reward_config_id,
            COALESCE(SUM(xt.xp_amount), 0) as total_xp
          FROM xp_transactions xt
          WHERE xt.user_id = ? AND xt.card_id = ?
          GROUP BY xt.reward_config_id
        `).bind(userId, cardDbId).all();

        // Initialize XP counts
        let totalXP = 0;
        let readingXP = 0;
        let listeningXP = 0;
        let speakingXP = 0;
        let writingXP = 0;

        (xpData.results || []).forEach((xpRow) => {
          const xp = xpRow.total_xp || 0;
          const rewardConfigId = xpRow.reward_config_id;

          totalXP += xp; // Include ALL XP types in total (including srs_state_change)

          // Match by reward_config_id instead of action_type string
          if (rewardConfigId === REWARD_CONFIG_IDS.READING_8S) {
            readingXP = xp;
          } else if (rewardConfigId === REWARD_CONFIG_IDS.LISTENING_5S) {
            listeningXP = xp;
          } else if (rewardConfigId === REWARD_CONFIG_IDS.SPEAKING_ATTEMPT) {
            speakingXP = xp;
          } else if (rewardConfigId === REWARD_CONFIG_IDS.WRITING_ATTEMPT) {
            writingXP = xp;
          }
          // Note: SRS_STATE_CHANGE XP is included in totalXP but not tracked separately
        });

        // Build image and audio URLs from stored keys (do not reconstruct the path)
        const basePublic = (env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
        const imageUrl = row.image_key
          ? (basePublic ? `${basePublic}/${row.image_key}` : `/${row.image_key}`)
          : '';
        const audioUrl = row.audio_key
          ? (basePublic ? `${basePublic}/${row.audio_key}` : `/${row.audio_key}`)
          : '';

        return {
          id: cardDbId || cardDisplayId,  // Use unique card ID from database, fallback to display ID
          card_number: row.card_number || null,  // Card number in episode (for display purposes)
          film_id: filmSlug,
          episode_id: epSlug,
          episode: epSlug,
          episode_number: row.episode_number || null,
          start: row.start_time || 0,
          end: row.end_time || 0,
          duration: row.duration || 0,
          image_url: imageUrl,
          audio_url: audioUrl,
          sentence: row.sentence || null,
          card_type: row.card_type || null,
          length: row.length || null,
          difficulty_score: row.difficulty_score || null,
          subtitle: subtitle,
          srs_state: row.srs_state || 'none',
          film_title: row.film_title,
          created_at: row.state_created_at || row.created_at || null, // Use state_created_at (when user saved card) instead of created_at (when record was created)
          state_updated_at: row.state_updated_at || null, // Last time the SRS state was updated
          next_review_at: row.next_review_at || null,
          xp_total: totalXP,
          xp_reading: readingXP,
          xp_listening: listeningXP,
          xp_speaking: speakingXP,
          xp_writing: writingXP,
        };
      }));

      return json({
        cards: formattedCards,
        total,
        page,
        limit,
        has_more: offset + formattedCards.length < total
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/user/portfolio', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');

      if (!userId) {
        return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
      }

      // Ensure user_scores exists (create if not exists)
      await getOrCreateUserScores(env, userId);

      // Get user scores
      const scores = await env.DB.prepare(`
        SELECT 
          total_xp,
          level,
          coins,
          current_streak,
          longest_streak,
          total_listening_time,
          total_reading_time,
          total_speaking_attempt,
          total_writing_attempt
        FROM user_scores
        WHERE user_id = ?
      `).bind(userId).first();

      // Get total cards saved (with srs_state != 'none')
      const savedCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total
        FROM user_card_states
        WHERE user_id = ? AND srs_state != 'none'
      `).bind(userId).first();

      // Get total cards reviewed (sum of review_count)
      const reviewedCardsResult = await env.DB.prepare(`
        SELECT SUM(review_count) as total
        FROM user_card_states
        WHERE user_id = ?
      `).bind(userId).first();

      // Get count of cards due for review (next_review_at <= now or is null for 'new' state)
      const dueCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total
        FROM user_card_states
        WHERE user_id = ? 
          AND srs_state != 'none'
          AND (
            next_review_at IS NULL 
            OR next_review_at <= (unixepoch() * 1000)
          )
      `).bind(userId).first();

      return json({
        user_id: userId,
        total_xp: scores?.total_xp || 0,
        level: scores?.level || 1,
        coins: scores?.coins || 0,
        current_streak: scores?.current_streak || 0,
        longest_streak: scores?.longest_streak || 0,
        total_cards_saved: savedCardsResult?.total || 0,
        total_cards_reviewed: reviewedCardsResult?.total || 0,
        total_listening_time: scores?.total_listening_time || 0,
        total_reading_time: scores?.total_reading_time || 0,
        total_speaking_attempt: scores?.total_speaking_attempt || 0,
        total_writing_attempt: scores?.total_writing_attempt || 0,
        due_cards_count: dueCardsResult?.total || 0,
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/user/track-time', async (request, env) => {
    try {
      let body;
      try {
        body = await request.json();
      } catch (parseError) {
        return json({ error: 'Failed to parse body as JSON', details: String(parseError) }, { status: 400 });
      }

      const { user_id, time_seconds, type } = body;

      if (!user_id || time_seconds === undefined || !type) {
        return json({ error: 'Missing required parameters (user_id, time_seconds, type)' }, { status: 400 });
      }

      if (type !== 'listening' && type !== 'reading') {
        return json({ error: 'Invalid type. Must be "listening" or "reading"' }, { status: 400 });
      }

      if (time_seconds <= 0) {
        return json({ error: 'time_seconds must be positive' }, { status: 400 });
      }

      const result = await trackTime(env, user_id, time_seconds, type);

      return json({ success: true, xp_awarded: result.xpAwarded });
    } catch (e) {
      const errorMessage = e?.message || String(e) || 'Unknown error';
      return json({ error: 'D1_ERROR: ' + errorMessage }, { status: 500 });
    }
  });

  router.post('/api/user/track-attempt', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      let body;
      try {
        body = await request.json();
      } catch (parseError) {
        return json({ error: 'Failed to parse body as JSON', details: String(parseError) }, { status: 400 });
      }

      const { user_id, type, card_id, film_id } = body;
      const userId = auth.userId || user_id;

      if (!userId || !type) {
        return json({ error: 'Missing required parameters (user_id, type)' }, { status: 400 });
      }

      if (type !== 'speaking' && type !== 'writing') {
        return json({ error: 'Invalid type. Must be "speaking" or "writing"' }, { status: 400 });
      }

      const result = await trackAttempt(env, userId, type, card_id || null, film_id || null);

      return json({ success: true, xp_awarded: result.xpAwarded });
    } catch (e) {
      const errorMessage = e?.message || String(e) || 'Unknown error';
      return json({ error: 'D1_ERROR: ' + errorMessage }, { status: 500 });
    }
  });

  router.get('/api/user/streak-history', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');

      if (!userId) {
        return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
      }

      // Get streak history (last 210 days to cover ~7 months for heatmap)
      const history = await env.DB.prepare(`
        SELECT streak_date, streak_achieved, streak_count
        FROM user_streak_history
        WHERE user_id = ?
        ORDER BY streak_date DESC
        LIMIT 210
      `).bind(userId).all();

      return json(history.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/user/metrics', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      const userId = auth.userId;

      // SRS Metrics
      const newCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? AND srs_state = 'new'
      `).bind(userId).first();

      const againCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? AND srs_state = 'again'
      `).bind(userId).first();

      const hardCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? AND srs_state = 'hard'
      `).bind(userId).first();

      const goodCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? AND srs_state = 'good'
      `).bind(userId).first();

      const easyCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? AND srs_state = 'easy'
      `).bind(userId).first();

      const dueCardsResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_card_states
        WHERE user_id = ? 
          AND srs_state != 'none'
          AND (
            next_review_at IS NULL 
            OR next_review_at <= (unixepoch() * 1000)
          )
      `).bind(userId).first();

      // Average interval (in days) - only for cards with srs_state != 'none' and srs_interval > 0
      const avgIntervalResult = await env.DB.prepare(`
        SELECT AVG(srs_interval) as avg_interval
        FROM user_card_states
        WHERE user_id = ? 
          AND srs_state != 'none'
          AND srs_interval > 0
      `).bind(userId).first();

      const avgIntervalDays = avgIntervalResult?.avg_interval ? (avgIntervalResult.avg_interval / 24) : 0;

      // Get user_scores first (needed for listening_sessions_count and time metrics)
      const scores = await getOrCreateUserScores(env, userId);

      // Get reward_config by IDs for listening and reading
      const listeningRewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.LISTENING_5S);
      const readingRewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.READING_8S);

      // Listening Metrics - Count XP transactions using reward_config_id (more precise than description)
      let listeningXPResult = { total_xp: 0 };
      if (listeningRewardConfig?.id) {
        listeningXPResult = await env.DB.prepare(`
          SELECT COALESCE(SUM(xp_amount), 0) as total_xp
          FROM xp_transactions
          WHERE user_id = ? AND reward_config_id = ?
        `).bind(userId, listeningRewardConfig.id).first();
      }

      // Listening Count - use listening_sessions_count from user_scores if available, otherwise count XP transactions
      // Note: listening_sessions_count counts actual play events, while XP transactions count completed intervals
      const listeningCount = scores?.listening_sessions_count || 0;
      // Fallback: count XP transactions if listening_sessions_count is 0 (backward compatibility)
      let listeningCountValue = listeningCount;
      if (listeningCountValue === 0 && listeningRewardConfig?.id) {
        const listeningCountResult = await env.DB.prepare(`
          SELECT COUNT(*) as total
          FROM xp_transactions
          WHERE user_id = ? AND reward_config_id = ?
        `).bind(userId, listeningRewardConfig.id).first();
        listeningCountValue = listeningCountResult?.total || 0;
      }

      // Reading Metrics - Count XP transactions using reward_config_id (more precise than description)
      let readingXPResult = { total_xp: 0 };
      if (readingRewardConfig?.id) {
        readingXPResult = await env.DB.prepare(`
          SELECT COALESCE(SUM(xp_amount), 0) as total_xp
          FROM xp_transactions
          WHERE user_id = ? AND reward_config_id = ?
        `).bind(userId, readingRewardConfig.id).first();
      }

      // Review Count - sum of review_count from user_card_states (pointer hover > 2s)
      const reviewCountResult = await env.DB.prepare(`
        SELECT COALESCE(SUM(review_count), 0) as total
        FROM user_card_states
        WHERE user_id = ?
      `).bind(userId).first();

      return json({
        srs_metrics: {
          new_cards: newCardsResult?.total || 0,
          again_cards: againCardsResult?.total || 0,
          hard_cards: hardCardsResult?.total || 0,
          good_cards: goodCardsResult?.total || 0,
          easy_cards: easyCardsResult?.total || 0,
          due_cards: dueCardsResult?.total || 0,
          average_interval_days: Math.round(avgIntervalDays * 100) / 100 // Round to 2 decimals
        },
        listening_metrics: {
          time_minutes: Math.round((scores?.total_listening_time || 0) / 60),
          count: listeningCountValue,
          xp: listeningXPResult?.total_xp || 0
        },
        reading_metrics: {
          time_minutes: Math.round((scores?.total_reading_time || 0) / 60),
          count: reviewCountResult?.total || 0,
          xp: readingXPResult?.total_xp || 0
        }
      });
    } catch (e) {
      console.error('Metrics error:', e);
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/user/increment-listening-session', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      const userId = auth.userId;

      // Ensure user_scores exists
      await getOrCreateUserScores(env, userId);

      // Increment listening_sessions_count
      await env.DB.prepare(`
        UPDATE user_scores
        SET listening_sessions_count = listening_sessions_count + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ?
      `).bind(userId).run();

      // Get updated count
      const updated = await env.DB.prepare(`
        SELECT listening_sessions_count FROM user_scores WHERE user_id = ?
      `).bind(userId).first();

      return json({
        success: true,
        listening_sessions_count: updated?.listening_sessions_count || 0
      });
    } catch (e) {
      console.error('Increment listening session error:', e);
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/user/monthly-xp', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const year = parseInt(url.searchParams.get('year') || '0');
      const month = parseInt(url.searchParams.get('month') || '0');

      if (!userId || !year || !month || month < 1 || month > 12) {
        return json({ error: 'Missing or invalid parameters (user_id, year, month)' }, { status: 400 });
      }

      // Calculate first and last day of month
      const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

      // Get daily XP data for the month
      const stats = await env.DB.prepare(`
        SELECT stats_date, xp_earned
        FROM user_daily_stats
        WHERE user_id = ? 
          AND stats_date >= ? 
          AND stats_date <= ?
        ORDER BY stats_date ASC
      `).bind(userId, firstDay, lastDay).all();

      // Create a map for quick lookup
      const statsMap = new Map();
      (stats.results || []).forEach((row) => {
        statsMap.set(row.stats_date, row.xp_earned || 0);
      });

      // Generate all days in the month with XP data
      const daysInMonth = new Date(year, month, 0).getDate();
      const monthlyData = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        monthlyData.push({
          date: dateStr,
          xp_earned: statsMap.get(dateStr) || 0
        });
      }

      return json(monthlyData);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
