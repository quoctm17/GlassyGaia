import { json } from '../utils/response.js';
import { REWARD_CONFIG_IDS } from '../utils/constants.js';
import { authenticateRequest } from '../middleware/auth.js';
import { getCardUUID } from '../services/cardHelpers.js';
import { getOrCreateUserScores, getRewardConfigById, calculateSRSInterval, shouldIncrementSRSCount, awardXP, awardCoins } from '../services/gamification.js';

export function registerCardOpsRoutes(router) {
  router.post('/api/card/save', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, card_id, film_id, episode_id } = body;

      if (!user_id || !card_id) {
        return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
      }

      // Get card UUID from display ID
      const cardUUID = await getCardUUID(env, film_id, episode_id, card_id);
      if (!cardUUID) {
        return json({ error: 'Card not found' }, { status: 404 });
      }

      // Get film_id and episode_id from card if not provided
      let finalFilmId = film_id;
      let finalEpisodeId = episode_id;

      if (!finalFilmId || !finalEpisodeId) {
        const cardInfo = await env.DB.prepare(`
          SELECT e.content_item_id, e.id as episode_id
          FROM cards c
          JOIN episodes e ON c.episode_id = e.id
          WHERE c.id = ?
        `).bind(cardUUID).first();

        if (cardInfo) {
          // Get film slug from content_item_id
          const filmInfo = await env.DB.prepare(`
            SELECT slug FROM content_items WHERE id = ?
          `).bind(cardInfo.content_item_id).first();

          finalFilmId = filmInfo?.slug || film_id;
          finalEpisodeId = cardInfo.episode_id || episode_id;
        }
      }

      // Check if card state already exists
      const existing = await env.DB.prepare(`
        SELECT id, srs_state FROM user_card_states
        WHERE user_id = ? AND card_id = ?
        LIMIT 1
      `).bind(user_id, cardUUID).first();

      let saved = false;

      if (existing) {
        if (existing.srs_state === 'none') {
          // Change from 'none' to 'new' (save)
          await env.DB.prepare(`
            UPDATE user_card_states
            SET srs_state = 'new',
                state_created_at = unixepoch() * 1000,
                state_updated_at = unixepoch() * 1000,
                updated_at = unixepoch() * 1000
            WHERE user_id = ? AND card_id = ?
          `).bind(user_id, cardUUID).run();
          saved = true;
        } else {
          // Change from any state to 'none' (unsave)
          await env.DB.prepare(`
            UPDATE user_card_states
            SET srs_state = 'none',
                state_updated_at = unixepoch() * 1000,
                updated_at = unixepoch() * 1000
            WHERE user_id = ? AND card_id = ?
          `).bind(user_id, cardUUID).run();
          saved = false;
        }
      } else {
        // Create new state with 'new' (save)
        const stateId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO user_card_states (
            id, user_id, card_id, film_id, episode_id,
            srs_state, state_created_at, state_updated_at,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'new', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
        `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId).run();
        saved = true;
      }

      return json({ saved });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/card/save-status-batch', async (request, env) => {
    try {
      const body = await request.json();
      const userId = body.user_id;
      const cards = body.cards || []; // Array of {card_id, film_id, episode_id}

      if (!userId || !Array.isArray(cards) || cards.length === 0) {
        return json({ error: 'Missing required parameters (user_id, cards array)' }, { status: 400 });
      }

      // Limit batch size to prevent timeout
      const MAX_BATCH_SIZE = 100;
      const cardsToProcess = cards.slice(0, MAX_BATCH_SIZE);

      // Group cards by film_id and episode_id for batch lookup
      const filmEpisodeMap = new Map();
      cardsToProcess.forEach(card => {
        if (!card.film_id || !card.episode_id) return;
        const key = `${card.film_id}|${card.episode_id}`;
        if (!filmEpisodeMap.has(key)) {
          filmEpisodeMap.set(key, { film_id: card.film_id, episode_id: card.episode_id, cards: [] });
        }
        filmEpisodeMap.get(key).cards.push(card);
      });

      // Batch get card UUIDs by film/episode groups
      const cardUUIDPromises = Array.from(filmEpisodeMap.values()).map(async (group) => {
        // Parse episode number
        let epNum = parseInt(String(group.episode_id).replace(/^e/i, ''));
        if (isNaN(epNum)) {
          const m = String(group.episode_id).match(/_(\d+)$/);
          epNum = m ? parseInt(m[1]) : 1;
        }

        // Get film and episode IDs once per group
        const film = await env.DB.prepare(`SELECT id FROM content_items WHERE slug = ?`).bind(group.film_id).first();
        if (!film) return [];

        const ep = await env.DB.prepare(`SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?`).bind(film.id, epNum).first();
        if (!ep) return [];

        // Get all card UUIDs for this episode in one query
        const cardNumbers = group.cards.map(c => {
          const num = parseInt(c.card_id);
          return isNaN(num) ? null : num;
        }).filter(n => n !== null);

        if (cardNumbers.length === 0) return [];

        const placeholders = cardNumbers.map(() => '?').join(',');
        const cardRows = await env.DB.prepare(`
          SELECT card_number, id FROM cards 
          WHERE episode_id = ? AND card_number IN (${placeholders})
        `).bind(ep.id, ...cardNumbers).all();

        // Map card_number to card_id
        const numberToUUID = new Map();
        if (cardRows.results) {
          cardRows.results.forEach(row => {
            numberToUUID.set(row.card_number, row.id);
          });
        }

        // Return mappings for all cards in this group
        return group.cards.map(card => {
          const num = parseInt(card.card_id);
          const uuid = isNaN(num) ? null : numberToUUID.get(num);
          return { card_id: card.card_id, uuid };
        });
      });

      const cardUUIDArrays = await Promise.all(cardUUIDPromises);
      const cardUUIDs = cardUUIDArrays.flat();
      const validUUIDs = cardUUIDs.filter(c => c.uuid !== null);

      if (validUUIDs.length === 0) {
        // Return default values for all cards
        const result = {};
        cardsToProcess.forEach(card => {
          result[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
        });
        return json(result);
      }

      // Batch query all save statuses in one query
      const uuids = validUUIDs.map(c => c.uuid);
      const placeholders = uuids.map(() => '?').join(',');
      const query = `
        SELECT card_id, srs_state, review_count 
        FROM user_card_states
        WHERE user_id = ? AND card_id IN (${placeholders})
      `;

      const results = await env.DB.prepare(query)
        .bind(userId, ...uuids)
        .all();

      // Build result map
      const resultMap = {};
      const uuidToCardId = new Map(validUUIDs.map(c => [c.uuid, c.card_id]));

      // Initialize all cards with default values
      cardsToProcess.forEach(card => {
        resultMap[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
      });

      // Update with actual results
      if (results.results) {
        for (const row of results.results) {
          const cardId = uuidToCardId.get(row.card_id);
          if (cardId) {
            const saved = row.srs_state && row.srs_state !== 'none';
            resultMap[cardId] = {
              saved,
              srs_state: row.srs_state || 'none',
              review_count: row.review_count || 0
            };
          }
        }
      }

      return json(resultMap);
    } catch (e) {
      console.error('[save-status-batch] Error:', e);
      // Return default values for all cards on error
      try {
        const body = await request.json();
        const result = {};
        (body.cards || []).forEach(card => {
          result[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
        });
        return json(result);
      } catch (parseError) {
        return json({});
      }
    }
  });

  router.get('/api/card/save-status', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const cardId = url.searchParams.get('card_id');
      const filmId = url.searchParams.get('film_id');
      const episodeId = url.searchParams.get('episode_id');

      if (!userId || !cardId) {
        return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
      }

      // Get card UUID from display ID (filmId and episodeId are required)
      if (!filmId || !episodeId) {
        return json({ saved: false, srs_state: 'none', review_count: 0 });
      }

      const cardUUID = await getCardUUID(env, filmId, episodeId, cardId);
      if (!cardUUID) {
        return json({ saved: false, srs_state: 'none', review_count: 0 });
      }

      const result = await env.DB.prepare(`
        SELECT srs_state, review_count FROM user_card_states
        WHERE user_id = ? AND card_id = ?
        LIMIT 1
      `).bind(userId, cardUUID).first();

      const saved = result && result.srs_state && result.srs_state !== 'none';

      return json({
        saved,
        srs_state: result?.srs_state || 'none',
        review_count: result?.review_count || 0
      });
    } catch (e) {
      console.error('[save-status] Error:', e);
      // Return proper JSON error response with fallback values
      return json({
        error: e.message || 'Internal server error',
        saved: false,
        srs_state: 'none',
        review_count: 0
      }, { status: 500 });
    }
  });

  router.post('/api/card/increment-review', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, card_id, film_id, episode_id } = body;

      if (!user_id || !card_id) {
        return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
      }

      let cardUUID = null;

      // Try to get card UUID from display ID if film_id and episode_id are provided
      if (film_id && episode_id) {
        cardUUID = await getCardUUID(env, film_id, episode_id, card_id);
      }

      // If getCardUUID failed or film_id/episode_id not provided, try alternative methods
      if (!cardUUID) {
        // First, try if card_id is already a UUID (direct lookup)
        const directCard = await env.DB.prepare(`
          SELECT id FROM cards WHERE id = ?
        `).bind(card_id).first();

        if (directCard) {
          cardUUID = directCard.id;
        } else if (film_id && episode_id) {
          // Try alternative parsing if we have film_id and episode_id
          const film = await env.DB.prepare(`
            SELECT id FROM content_items WHERE slug = ?
          `).bind(film_id).first();

          if (film) {
            let epNum = parseInt(String(episode_id).replace(/^e/i, ''));
            if (isNaN(epNum)) {
              const m = String(episode_id).match(/_(\d+)$/);
              epNum = m ? parseInt(m[1]) : null;
            }

            if (epNum !== null && !isNaN(epNum)) {
              const ep = await env.DB.prepare(`
                SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
              `).bind(film.id, epNum).first();

              if (ep) {
                const cardNum = parseInt(card_id);
                if (!isNaN(cardNum)) {
                  const card = await env.DB.prepare(`
                    SELECT id FROM cards WHERE episode_id = ? AND card_number = ?
                  `).bind(ep.id, cardNum).first();
                  if (card) {
                    cardUUID = card.id;
                  }
                }
              }
            }
          }
        }
      }

      if (!cardUUID) {
        return json({ error: 'Card not found. Please provide film_id and episode_id.' }, { status: 404 });
      }

      // Check if card state exists, if not create it
      const existing = await env.DB.prepare(`
        SELECT id, review_count FROM user_card_states
        WHERE user_id = ? AND card_id = ?
        LIMIT 1
      `).bind(user_id, cardUUID).first();

      let reviewCount = 0;

      if (existing) {
        // Increment existing review count
        await env.DB.prepare(`
          UPDATE user_card_states
          SET review_count = review_count + 1,
              updated_at = unixepoch() * 1000
          WHERE user_id = ? AND card_id = ?
        `).bind(user_id, cardUUID).run();

        reviewCount = (existing.review_count || 0) + 1;
      } else {
        // Create new state with review_count = 1
        // Get film_id and episode_id from card if not provided
        let finalFilmId = film_id;
        let finalEpisodeId = episode_id;

        if (!finalFilmId || !finalEpisodeId) {
          const cardInfo = await env.DB.prepare(`
            SELECT e.content_item_id, e.id as episode_id
            FROM cards c
            JOIN episodes e ON c.episode_id = e.id
            WHERE c.id = ?
          `).bind(cardUUID).first();

          if (cardInfo) {
            const filmInfo = await env.DB.prepare(`
              SELECT slug FROM content_items WHERE id = ?
            `).bind(cardInfo.content_item_id).first();

            finalFilmId = filmInfo?.slug || film_id;
            finalEpisodeId = cardInfo.episode_id || episode_id;
          }
        }

        // Use INSERT OR IGNORE to handle race conditions
        // If record already exists, we'll update it instead
        const stateId = crypto.randomUUID();
        try {
          await env.DB.prepare(`
            INSERT INTO user_card_states (
              id, user_id, card_id, film_id, episode_id,
              srs_state, review_count, state_created_at, state_updated_at,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 'none', 1, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
          `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId).run();
          reviewCount = 1;
        } catch (insertError) {
          // If INSERT fails due to UNIQUE constraint, record already exists
          // Re-check and update instead
          const recheck = await env.DB.prepare(`
            SELECT id, review_count FROM user_card_states
            WHERE user_id = ? AND card_id = ?
            LIMIT 1
          `).bind(user_id, cardUUID).first();

          if (recheck) {
            await env.DB.prepare(`
              UPDATE user_card_states
              SET review_count = review_count + 1,
                  updated_at = unixepoch() * 1000
              WHERE user_id = ? AND card_id = ?
            `).bind(user_id, cardUUID).run();
            reviewCount = (recheck.review_count || 0) + 1;
          } else {
            // If still not found, throw the original error
            throw insertError;
          }
        }
      }

      return json({ review_count: reviewCount });
    } catch (e) {
      console.error('[increment-review] Error:', e);
      return json({ error: e.message || 'Internal server error' }, { status: 500 });
    }
  });

  router.post('/api/card/srs-state', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, card_id, film_id, episode_id, srs_state } = body;

      if (!user_id || !card_id || !srs_state) {
        return json({ error: 'Missing required parameters (user_id, card_id, srs_state)' }, { status: 400 });
      }

      // Validate srs_state
      const validStates = ['none', 'new', 'again', 'hard', 'good', 'easy'];
      if (!validStates.includes(srs_state)) {
        return json({ error: 'Invalid srs_state' }, { status: 400 });
      }

      // Get card UUID from display ID
      const cardUUID = await getCardUUID(env, film_id, episode_id, card_id);
      if (!cardUUID) {
        return json({ error: 'Card not found' }, { status: 404 });
      }

      // Initialize finalFilmId and finalEpisodeId from request params
      let finalFilmId = film_id || null;
      let finalEpisodeId = episode_id || null;

      // If not provided, get from existing state or card info
      if (!finalFilmId || !finalEpisodeId) {
        const existingState = await env.DB.prepare(`
          SELECT film_id, episode_id FROM user_card_states
          WHERE user_id = ? AND card_id = ?
          LIMIT 1
        `).bind(user_id, cardUUID).first();

        if (existingState) {
          finalFilmId = finalFilmId || existingState.film_id || null;
          finalEpisodeId = finalEpisodeId || existingState.episode_id || null;
        }

        // If still not found, get from card info
        if (!finalFilmId || !finalEpisodeId) {
          const cardInfo = await env.DB.prepare(`
            SELECT e.content_item_id, e.id as episode_id
            FROM cards c
            JOIN episodes e ON c.episode_id = e.id
            WHERE c.id = ?
          `).bind(cardUUID).first();

          if (cardInfo) {
            if (!finalFilmId) {
              const filmInfo = await env.DB.prepare(`
                SELECT slug FROM content_items WHERE id = ?
              `).bind(cardInfo.content_item_id).first();
              finalFilmId = filmInfo?.slug || null;
            }
            if (!finalEpisodeId) {
              finalEpisodeId = cardInfo.episode_id || null;
            }
          }
        }
      }

      // Check if card state exists and get current values
      const existing = await env.DB.prepare(`
        SELECT id, srs_state, srs_count, speaking_attempt, writing_attempt, state_created_at
        FROM user_card_states
        WHERE user_id = ? AND card_id = ?
        LIMIT 1
      `).bind(user_id, cardUUID).first();

      // Get old state to check if it's a change (not from 'none' to 'none')
      const oldState = existing?.srs_state || 'none';
      const oldSRSCount = existing?.srs_count || 0;
      const speakingAttempt = existing?.speaking_attempt || 0;
      const writingAttempt = existing?.writing_attempt || 0;

      // Calculate new srs_count based on state transition
      let newSRSCount = oldSRSCount;
      if (oldState !== srs_state && oldState !== 'none' && srs_state !== 'none') {
        // Only update srs_count if state actually changed (not to/from 'none')
        // This handles transitions between: 'new', 'again', 'hard', 'good', 'easy'
        // shouldIncrementSRSCount will return false for transitions involving 'new' or 'none'
        if (shouldIncrementSRSCount(oldState, srs_state)) {
          newSRSCount = oldSRSCount + 1;
        }
        // If downgrade, re-affirm again/hard, or transition from/to 'new', keep srs_count unchanged
      } else if (oldState === 'none' && srs_state !== 'none') {
        // First time setting state (from 'none' to any state) - start with 0
        newSRSCount = 0;
      }

      // Calculate SRS interval and next_review_at
      const now = Date.now();
      let srsInterval = 0;
      let nextReviewAt = null;
      let lastReviewedAt = null;

      if (srs_state !== 'none') {
        // Calculate interval in hours
        srsInterval = await calculateSRSInterval(env, srs_state, newSRSCount, speakingAttempt, writingAttempt);

        // Set last_reviewed_at when state changes (not when setting to 'none')
        if (oldState !== srs_state) {
          lastReviewedAt = now;
          // next_review_at = last_reviewed_at + (interval in milliseconds)
          nextReviewAt = now + (srsInterval * 60 * 60 * 1000);
        } else {
          // If state didn't change, keep existing values
          const existingState = await env.DB.prepare(`
            SELECT last_reviewed_at, next_review_at FROM user_card_states
            WHERE user_id = ? AND card_id = ?
          `).bind(user_id, cardUUID).first();
          lastReviewedAt = existingState?.last_reviewed_at || null;
          nextReviewAt = existingState?.next_review_at || null;
        }
      }

      if (existing) {
        // Update existing state
        await env.DB.prepare(`
          UPDATE user_card_states
          SET srs_state = ?,
              srs_count = ?,
              srs_interval = ?,
              next_review_at = ?,
              last_reviewed_at = ?,
              state_updated_at = unixepoch() * 1000,
              updated_at = unixepoch() * 1000
          WHERE user_id = ? AND card_id = ?
        `).bind(srs_state, newSRSCount, srsInterval, nextReviewAt, lastReviewedAt, user_id, cardUUID).run();
      } else {
        // Create new state (should not happen if card is not saved, but handle it)
        // Get film_id and episode_id from card
        const cardInfo = await env.DB.prepare(`
          SELECT e.content_item_id, e.id as episode_id
          FROM cards c
          JOIN episodes e ON c.episode_id = e.id
          WHERE c.id = ?
        `).bind(cardUUID).first();

        let finalFilmId = film_id || null;
        let finalEpisodeId = episode_id || null;

        if (cardInfo) {
          if (!finalFilmId) {
            const filmInfo = await env.DB.prepare(`
              SELECT slug FROM content_items WHERE id = ?
            `).bind(cardInfo.content_item_id).first();
            finalFilmId = filmInfo?.slug || null;
          }
          if (!finalEpisodeId) {
            finalEpisodeId = cardInfo.episode_id || null;
          }
        }

        // Calculate SRS interval and next_review_at for new state
        let srsInterval = 0;
        let nextReviewAt = null;
        let lastReviewedAt = null;
        let newSRSCount = 0;

        if (srs_state !== 'none') {
          // Calculate interval in hours
          srsInterval = await calculateSRSInterval(env, srs_state, newSRSCount, 0, 0);

          // Set timestamps for new state
          const now = Date.now();
          lastReviewedAt = now;
          nextReviewAt = now + (srsInterval * 60 * 60 * 1000);
        }

        const stateId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO user_card_states (
            id, user_id, card_id, film_id, episode_id,
            srs_state, srs_count, srs_interval, next_review_at, last_reviewed_at,
            state_created_at, state_updated_at,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
        `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId, srs_state, newSRSCount, srsInterval, nextReviewAt, lastReviewedAt).run();
      }

      // Award XP for SRS state change (whenever state changes and new state is not 'none')
      // This includes: 'none' -> any state, or any state -> any other state
      if (oldState !== srs_state && srs_state !== 'none') {
        const rewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.SRS_STATE_CHANGE);
        if (rewardConfig && rewardConfig.xp_amount > 0) {
          await awardXP(env, user_id, rewardConfig.xp_amount, rewardConfig.id, 'SRS state change', cardUUID, finalFilmId);
        }
      }

      return json({ success: true, srs_state });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
