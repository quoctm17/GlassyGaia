import { json } from '../utils/response.js';

export function registerProgressRoutes(router) {
  router.post('/api/progress/complete', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_id, episode_slug, card_id, card_index, total_cards } = body;

      if (!user_id || !film_id || !episode_slug || !card_id || card_index === undefined) {
        return json({ error: 'Missing required fields' }, { status: 400 });
      }

      const now = Date.now();

      // Insert or update card progress (upsert using ON CONFLICT)
      await env.DB.prepare(`
        INSERT INTO user_progress (user_id, film_id, episode_slug, card_id, card_index, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, film_id, episode_slug, card_id) 
        DO UPDATE SET completed_at = ?, updated_at = ?
      `).bind(user_id, film_id, episode_slug, card_id, card_index, now, now, now, now).run();

      // Update episode stats
      const completedCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
      `).bind(user_id, film_id, episode_slug).first();

      const completed = completedCount?.count || 0;
      const total = total_cards || completed; // Use provided total or fall back to completed count
      const percentage = total > 0 ? (completed / total) * 100 : 0;

      await env.DB.prepare(`
        INSERT INTO user_episode_stats 
          (user_id, film_id, episode_slug, total_cards, completed_cards, last_card_index, completion_percentage, last_completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, film_id, episode_slug)
        DO UPDATE SET 
          total_cards = ?,
          completed_cards = ?,
          last_card_index = ?,
          completion_percentage = ?,
          last_completed_at = ?,
          updated_at = ?
      `).bind(
        user_id, film_id, episode_slug, total, completed, card_index, percentage, now, now,
        total, completed, card_index, percentage, now, now
      ).run();

      return json({
        success: true,
        completed_cards: completed,
        total_cards: total,
        completion_percentage: percentage
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.delete('/api/progress/complete', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_id, episode_slug, card_id, total_cards } = body;

      if (!user_id || !film_id || !episode_slug || !card_id) {
        return json({ error: 'Missing required fields' }, { status: 400 });
      }

      const now = Date.now();

      // Delete card progress
      await env.DB.prepare(`
        DELETE FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ? AND card_id = ?
      `).bind(user_id, film_id, episode_slug, card_id).run();

      // Update episode stats
      const completedCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
      `).bind(user_id, film_id, episode_slug).first();

      const completed = completedCount?.count || 0;
      const total = total_cards || completed; // Use provided total or fall back to completed count
      const percentage = total > 0 ? (completed / total) * 100 : 0;

      // Get last card index if any cards remain
      const lastCard = await env.DB.prepare(`
        SELECT card_index FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
        ORDER BY card_index DESC LIMIT 1
      `).bind(user_id, film_id, episode_slug).first();

      const lastCardIndex = lastCard?.card_index ?? 0;

      await env.DB.prepare(`
        INSERT INTO user_episode_stats 
          (user_id, film_id, episode_slug, total_cards, completed_cards, last_card_index, completion_percentage, last_completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, film_id, episode_slug)
        DO UPDATE SET 
          total_cards = ?,
          completed_cards = ?,
          last_card_index = ?,
          completion_percentage = ?,
          updated_at = ?
      `).bind(
        user_id, film_id, episode_slug, total, completed, lastCardIndex, percentage, now, now,
        total, completed, lastCardIndex, percentage, now
      ).run();

      return json({
        success: true,
        completed_cards: completed,
        total_cards: total,
        completion_percentage: percentage
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/progress/episode', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');
      const episodeSlug = url.searchParams.get('episode_slug');

      if (!userId || !filmId || !episodeSlug) {
        return json({ error: 'Missing required parameters' }, { status: 400 });
      }

      // Get episode stats
      const stats = await env.DB.prepare(`
        SELECT * FROM user_episode_stats 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
      `).bind(userId, filmId, episodeSlug).first();

      // Get all completed cards for this episode
      const cards = await env.DB.prepare(`
        SELECT * FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
        ORDER BY card_index ASC
      `).bind(userId, filmId, episodeSlug).all();

      const completed = cards.results || [];
      const completedCardIds = completed.map(c => c.card_id);
      const completedIndices = completed.map(c => c.card_index);

      return json({
        episode_stats: stats || null,
        completed_cards: completed,
        completed_card_ids: completedCardIds,
        completed_indices: completedIndices
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/progress/film', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');

      if (!userId || !filmId) {
        return json({ error: 'Missing required parameters' }, { status: 400 });
      }

      const stats = await env.DB.prepare(`
        SELECT * FROM user_episode_stats 
        WHERE user_id = ? AND film_id = ?
        ORDER BY episode_slug ASC
      `).bind(userId, filmId).all();

      return json(stats.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/progress/reset', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_id, episode_slug } = body;

      if (!user_id || !film_id || !episode_slug) {
        return json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Delete all card progress for this episode
      await env.DB.prepare(`
        DELETE FROM user_progress 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
      `).bind(user_id, film_id, episode_slug).run();

      // Delete episode stats
      await env.DB.prepare(`
        DELETE FROM user_episode_stats 
        WHERE user_id = ? AND film_id = ? AND episode_slug = ?
      `).bind(user_id, film_id, episode_slug).run();

      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/srs/distribution', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');

      if (!userId || !filmId) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      // Get total number of cards in this film
      const filmRow = await env.DB.prepare(`
        SELECT num_cards FROM content_items WHERE slug = ?
      `).bind(filmId).first();

      const totalCards = filmRow?.num_cards || 0;

      // Get SRS state distribution from user_card_states
      const srsStats = await env.DB.prepare(`
        SELECT srs_state, COUNT(*) as count
        FROM user_card_states
        WHERE user_id = ? AND film_id = ?
        GROUP BY srs_state
      `).bind(userId, filmId).all();

      const stats = srsStats.results || [];
      const savedCards = stats.reduce((sum, row) => sum + (row.count || 0), 0);

      // Calculate distribution
      const distribution = {
        none: 0,
        new: 0,
        again: 0,
        hard: 0,
        good: 0,
        easy: 0
      };

      if (totalCards === 0) {
        // No cards in film, all none
        distribution.none = 100;
      } else if (savedCards === 0) {
        // No cards saved, all none
        distribution.none = 100;
      } else {
        // Calculate percentages based on saved cards
        stats.forEach((row) => {
          const state = row.srs_state || 'none';
          const count = row.count || 0;
          if (state in distribution) {
            distribution[state] = Math.round((count / totalCards) * 100);
          }
        });

        // Calculate none percentage (cards not saved)
        const noneCount = totalCards - savedCards;
        distribution.none = Math.round((noneCount / totalCards) * 100);

        // Normalize to ensure total is 100%
        const total = Object.values(distribution).reduce((a, b) => a + b, 0);
        if (total !== 100) {
          const diff = 100 - total;
          // Adjust the largest non-none value
          const nonNoneStates = ['new', 'again', 'hard', 'good', 'easy'];
          let maxState = 'new';
          let maxValue = distribution.new;
          nonNoneStates.forEach(state => {
            if (distribution[state] > maxValue) {
              maxValue = distribution[state];
              maxState = state;
            }
          });
          distribution[maxState] += diff;
        }
      }

      return json(distribution);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
