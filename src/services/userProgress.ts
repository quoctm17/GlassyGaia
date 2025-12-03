// User progress tracking service - API calls to Cloudflare Worker

import type {
  UserCardProgress,
  UserEpisodeStats,
  MarkCardCompleteRequest,
  GetProgressResponse,
} from "../types";

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(
  import.meta.env.VITE_CF_API_BASE as string | undefined
);

function assertApiBase() {
  if (!API_BASE) {
    throw new Error(
      "VITE_CF_API_BASE is not set. Provide your Cloudflare Worker/Pages API base URL."
    );
  }
}

/**
 * Mark a card as completed for a user
 */
export async function markCardComplete(
  data: MarkCardCompleteRequest
): Promise<UserCardProgress> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/progress/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to mark card complete: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get progress for a user on a specific episode
 */
export async function getEpisodeProgress(
  userId: string,
  filmId: string,
  episodeSlug: string
): Promise<GetProgressResponse> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    film_id: filmId,
    episode_slug: episodeSlug,
  });

  const res = await fetch(`${API_BASE}/api/progress/episode?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // No progress yet - return empty state
      return {
        episode_stats: null,
        completed_cards: [],
        completed_card_ids: new Set(),
        completed_indices: new Set(),
      };
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get episode progress: ${res.status} ${text}`);
  }

  const data = await res.json();
  
  // Convert arrays to Sets for easier lookup
  return {
    episode_stats: data.episode_stats || null,
    completed_cards: data.completed_cards || [],
    completed_card_ids: new Set(data.completed_card_ids || []),
    completed_indices: new Set(data.completed_indices || []),
  };
}

/**
 * Get all progress for a user on a film (all episodes)
 */
export async function getFilmProgress(
  userId: string,
  filmId: string
): Promise<UserEpisodeStats[]> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    film_id: filmId,
  });

  const res = await fetch(`${API_BASE}/api/progress/film?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return [];
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get film progress: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Reset progress for a user on an episode
 */
export async function resetEpisodeProgress(
  userId: string,
  filmId: string,
  episodeSlug: string
): Promise<{ success: boolean }> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/progress/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      film_id: filmId,
      episode_slug: episodeSlug,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to reset progress: ${res.status} ${text}`);
  }

  return res.json();
}
