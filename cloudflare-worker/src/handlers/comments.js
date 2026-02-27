import { json } from '../utils/response.js';

export function registerCommentRoutes(router) {
  // Get comments for an episode
  router.get('/api/episodes/comments', async (request, env) => {
    try {
      const url = new URL(request.url);
      const episodeSlug = url.searchParams.get('episode_slug');
      const filmSlug = url.searchParams.get('film_slug');

      if (!episodeSlug || !filmSlug) {
        return json({ error: 'Missing required parameters: episode_slug, film_slug' }, { status: 400 });
      }

      // Get content_item_id from film slug
      const filmRow = await env.DB.prepare(`
        SELECT id FROM content_items WHERE LOWER(slug) = LOWER(?)
      `).bind(filmSlug).first();

      if (!filmRow) {
        return json({ error: 'Content not found' }, { status: 404 });
      }

      // Get episode ID from slug and content_item_id
      const episodeRow = await env.DB.prepare(`
        SELECT id FROM episodes 
        WHERE slug = ? AND content_item_id = ?
      `).bind(episodeSlug, filmRow.id).first();

      if (!episodeRow) {
        return json({ error: 'Episode not found' }, { status: 404 });
      }

      // Get comments with user info, sorted by score (desc) then created_at (desc)
      const comments = await env.DB.prepare(`
        SELECT 
          ec.id,
          ec.text,
          ec.upvotes,
          ec.downvotes,
          ec.score,
          ec.created_at,
          ec.updated_at,
          u.id as user_id,
          u.display_name,
          u.photo_url
        FROM episode_comments ec
        JOIN users u ON ec.user_id = u.id
        WHERE ec.episode_id = ?
        ORDER BY ec.score DESC, ec.created_at DESC
      `).bind(episodeRow.id).all();

      return json(comments.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Create a new comment
  router.post('/api/episodes/comments', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, episode_slug, film_slug, text } = body;

      if (!user_id || !episode_slug || !film_slug || !text) {
        return json({ error: 'Missing required parameters (user_id, episode_slug, film_slug, text)' }, { status: 400 });
      }

      if (text.trim().length === 0 || text.length > 5000) {
        return json({ error: 'Comment text must be between 1 and 5000 characters' }, { status: 400 });
      }

      // Get content_item_id from film slug
      const filmRow = await env.DB.prepare(`
        SELECT id FROM content_items WHERE LOWER(slug) = LOWER(?)
      `).bind(film_slug).first();

      if (!filmRow) {
        return json({ error: 'Content not found' }, { status: 404 });
      }

      // Get episode ID from slug and content_item_id
      const episode = await env.DB.prepare(`
        SELECT id FROM episodes WHERE slug = ? AND content_item_id = ?
      `).bind(episode_slug, filmRow.id).first();

      if (!episode) {
        return json({ error: 'Episode not found' }, { status: 404 });
      }

      // Create comment
      const commentId = crypto.randomUUID();
      const now = Date.now();

      await env.DB.prepare(`
        INSERT INTO episode_comments (
          id, user_id, episode_id, content_item_id, text,
          upvotes, downvotes, score, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
      `).bind(commentId, user_id, episode.id, filmRow.id, text.trim(), now, now).run();

      // Get the created comment with user info
      const comment = await env.DB.prepare(`
        SELECT 
          ec.id,
          ec.text,
          ec.upvotes,
          ec.downvotes,
          ec.score,
          ec.created_at,
          ec.updated_at,
          u.id as user_id,
          u.display_name,
          u.photo_url
        FROM episode_comments ec
        JOIN users u ON ec.user_id = u.id
        WHERE ec.id = ?
      `).bind(commentId).first();

      return json(comment);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Vote on a comment (upvote or downvote)
  router.post('/api/episodes/comments/vote', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, comment_id, vote_type } = body;

      if (!user_id || !comment_id || vote_type === undefined) {
        return json({ error: 'Missing required parameters (user_id, comment_id, vote_type)' }, { status: 400 });
      }

      if (vote_type !== 1 && vote_type !== -1) {
        return json({ error: 'vote_type must be 1 (upvote) or -1 (downvote)' }, { status: 400 });
      }

      // Check if comment exists
      const comment = await env.DB.prepare(`
        SELECT id, upvotes, downvotes FROM episode_comments WHERE id = ?
      `).bind(comment_id).first();

      if (!comment) {
        return json({ error: 'Comment not found' }, { status: 404 });
      }

      // Check if user already voted
      const existingVote = await env.DB.prepare(`
        SELECT id, vote_type FROM episode_comment_votes
        WHERE user_id = ? AND comment_id = ?
      `).bind(user_id, comment_id).first();

      const now = Date.now();
      let newUpvotes = comment.upvotes || 0;
      let newDownvotes = comment.downvotes || 0;

      if (existingVote) {
        // User already voted - update or remove vote
        if (existingVote.vote_type === vote_type) {
          // Same vote type - remove the vote
          await env.DB.prepare(`
            DELETE FROM episode_comment_votes
            WHERE user_id = ? AND comment_id = ?
          `).bind(user_id, comment_id).run();

          // Decrement the count
          if (vote_type === 1) {
            newUpvotes = Math.max(0, newUpvotes - 1);
          } else {
            newDownvotes = Math.max(0, newDownvotes - 1);
          }
        } else {
          // Different vote type - update the vote
          await env.DB.prepare(`
            UPDATE episode_comment_votes
            SET vote_type = ?, updated_at = ?
            WHERE user_id = ? AND comment_id = ?
          `).bind(vote_type, now, user_id, comment_id).run();

          // Adjust counts
          if (existingVote.vote_type === 1) {
            // Was upvote, now downvote
            newUpvotes = Math.max(0, newUpvotes - 1);
            newDownvotes = newDownvotes + 1;
          } else {
            // Was downvote, now upvote
            newDownvotes = Math.max(0, newDownvotes - 1);
            newUpvotes = newUpvotes + 1;
          }
        }
      } else {
        // New vote
        const voteId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO episode_comment_votes (id, user_id, comment_id, vote_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(voteId, user_id, comment_id, vote_type, now, now).run();

        // Increment the count
        if (vote_type === 1) {
          newUpvotes = newUpvotes + 1;
        } else {
          newDownvotes = newDownvotes + 1;
        }
      }

      // Calculate new score
      const newScore = newUpvotes - newDownvotes;

      // Update comment scores
      await env.DB.prepare(`
        UPDATE episode_comments
        SET upvotes = ?, downvotes = ?, score = ?, updated_at = ?
        WHERE id = ?
      `).bind(newUpvotes, newDownvotes, newScore, now, comment_id).run();

      // Get user's current vote status
      const userVote = await env.DB.prepare(`
        SELECT vote_type FROM episode_comment_votes
        WHERE user_id = ? AND comment_id = ?
      `).bind(user_id, comment_id).first();

      return json({
        success: true,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        score: newScore,
        user_vote: userVote?.vote_type || null
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user's vote status for comments
  router.get('/api/episodes/comments/votes', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const commentIds = url.searchParams.get('comment_ids');

      if (!userId || !commentIds) {
        return json({ error: 'Missing required parameters (user_id, comment_ids)' }, { status: 400 });
      }

      // Parse comment_ids (comma-separated)
      const ids = commentIds.split(',').filter(id => id.trim());
      if (ids.length === 0) {
        return json({});
      }

      // Get all votes for these comments by this user
      const votes = await env.DB.prepare(`
        SELECT comment_id, vote_type
        FROM episode_comment_votes
        WHERE user_id = ? AND comment_id IN (${ids.map(() => '?').join(',')})
      `).bind(userId, ...ids).all();

      // Convert to object: { comment_id: vote_type }
      const voteMap = {};
      (votes.results || []).forEach(vote => {
        voteMap[vote.comment_id] = vote.vote_type;
      });

      return json(voteMap);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
