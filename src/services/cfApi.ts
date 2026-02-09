// Cloudflare API client and helpers for D1 + R2
import type { CardDoc, FilmDoc, EpisodeDetailDoc, LevelFrameworkStats, Category } from "../types";

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`; // default to https if scheme missing
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(
  import.meta.env.VITE_CF_API_BASE as string | undefined
);
const R2_PUBLIC_BASE =
  (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(
    /\/$/,
    ""
  ) || "";

function normalizeOriginalFlag(raw: number | boolean | undefined): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  return true; // default true when absent
}

function assertApiBase() {
  if (!API_BASE) {
    throw new Error(
      "VITE_CF_API_BASE is not set. Provide your Cloudflare Worker/Pages API base URL."
    );
  }
}

async function getJson<T>(path: string): Promise<T> {
  assertApiBase();
  const fullUrl = `${API_BASE}${path}`;
  const res = await fetch(fullUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store", 
  });
  if (!res.ok) {
    // Treat 404 as empty data so UI can show empty-state gracefully
    if (res.status === 404) {
      // Attempt to return sensible empty shape: [] or null
      // Caller should narrow type; we use 'any' cast here.
      return [] as unknown as T;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// Build media URLs when the API doesn't provide them explicitly.
export function buildR2MediaUrl(params: {
  filmId: string;
  episodeId: string; // accepts e1, e001, 1, filmSlug_1
  cardId: string; // display/card id; will be padded to 4 digits if numeric
  type: "audio" | "image";
  ext?: string; // optional: specify extension (avif, webp, jpg, opus, mp3, wav)
}): string {
  // New naming convention:
  // items/{filmId}/episodes/{filmId}_{episode3}/{type}/{filmId}_{episode3}_{card4}.{ext}
  const { filmId, episodeId, cardId, type, ext: providedExt } = params;
  let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
  if (!epNum || Number.isNaN(epNum)) {
    const m = String(episodeId || "").match(/_(\d+)$/);
    epNum = m ? Number(m[1]) : 1;
  }
  const epPadded = String(epNum).padStart(3, "0");
  const isDigits = /^[0-9]+$/.test(String(cardId));
  const cardPadded = isDigits ? String(cardId).padStart(4, "0") : String(cardId);
  const ext = providedExt || (type === "image" ? "jpg" : "mp3"); // default to legacy if not provided
  const rel = `items/${filmId}/episodes/${filmId}_${epPadded}/${type}/${filmId}_${epPadded}_${cardPadded}.${ext}`;
  return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${rel}` : `/${rel}`;
}

// Deprecated helper retained for backward compat (not used with new schema)
// remove unused legacy helper entirely

// New normalized endpoint: /items returns generic content items (films/music/books).
// We filter to type === 'film' for admin Films views.
export async function apiListFilms(): Promise<FilmDoc[]> {
  const items = await getJson<
    Array<Partial<FilmDoc> & { id: string; type?: string }>
  >(`/items`);
  return items
    .filter((f) => !f.type || f.type === "movie")
    .map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      cover_url: f.cover_url,
      main_language:
        (f as unknown as { main_language?: string; language?: string })
          .main_language ||
        (f as unknown as { main_language?: string; language?: string })
          .language,
      type: f.type,
      release_year: f.release_year,
      episodes: f.episodes,
      total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number })
        .total_episodes,
      available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
      is_original: normalizeOriginalFlag(
        (f as Partial<FilmDoc> & { is_original?: number | boolean }).is_original
      ),
    }));
}

// List all content items (any type) without client-side filtering
// Uses localStorage cache with 5-minute TTL to reduce repeated fetches
const ITEMS_CACHE_KEY = 'glassygaia_items_cache';

// Invalidate items cache (call after creating/updating/deleting content)
export function invalidateItemsCache(): void {
  try {
    localStorage.removeItem(ITEMS_CACHE_KEY);
  } catch {
    // Failed to clear cache (silent)
  }
}

export async function apiListItems(): Promise<FilmDoc[]> {
  const CACHE_KEY = ITEMS_CACHE_KEY;
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  try {
    // Check localStorage cache
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;
      if (age < CACHE_TTL) {
        // Using cached data
        return data;
      }
    }
  } catch {
    // Failed to read cache (silent)
  }
  
  // Fetch fresh data
  const items = await getJson<
    Array<Partial<FilmDoc> & { id: string; type?: string }>
  >(`/items`);
  
  const mapped = items.map((f) => ({
    id: f.id!,
    title: f.title,
    description: f.description,
    cover_url: f.cover_url,
    cover_landscape_url: (f as Partial<FilmDoc> & { cover_landscape_url?: string }).cover_landscape_url,
    main_language:
      (f as unknown as { main_language?: string; language?: string })
        .main_language ||
      (f as unknown as { main_language?: string; language?: string }).language,
    type: f.type,
    release_year: f.release_year,
    episodes: f.episodes,
    total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number })
      .total_episodes,
    available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
    is_original: normalizeOriginalFlag(
      (f as Partial<FilmDoc> & { is_original?: number | boolean }).is_original
    ),
    is_available: (() => {
      const raw = (f as Record<string, unknown>)["is_available"];
      if (raw === null || raw === undefined) return undefined;
      if (typeof raw === 'number') return raw === 1;
      if (typeof raw === 'string') {
        const v = raw.trim();
        if (v === '1' || v.toLowerCase() === 'true') return true;
        if (v === '0' || v.toLowerCase() === 'false') return false;
      }
      if (typeof raw === 'boolean') return raw;
      return undefined;
    })(),
    level_framework_stats: (f as Partial<FilmDoc> & { level_framework_stats?: string | LevelFrameworkStats[] | null }).level_framework_stats ?? null,
    categories: Array.isArray((f as Partial<FilmDoc> & { categories?: Category[] }).categories) 
      ? (f as Partial<FilmDoc> & { categories?: Category[] }).categories 
      : [],
  }));
  
  // Save to localStorage cache
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data: mapped,
      timestamp: Date.now()
    }));
    // Cache saved successfully
  } catch {
    // Failed to save cache (silent)
  }
  
  return mapped;
}

export async function apiGetFilm(filmId: string): Promise<FilmDoc | null> {
  try {
    const f = await getJson<Partial<FilmDoc> & { id?: string }>(
      `/items/${encodeURIComponent(filmId)}`
    );
    if (
      !f ||
      typeof f !== "object" ||
      Array.isArray(f) ||
      !("id" in f) ||
      !f.id
    ) {
      throw new Error("Not Found");
    }
    const lm = f as unknown as { main_language?: string; language?: string };
    const film: FilmDoc = {
      id: f.id!,
      title: f.title,
      description: f.description,
      cover_url: f.cover_url,
      cover_landscape_url: (f as Partial<FilmDoc> & { cover_landscape_url?: string }).cover_landscape_url,
      main_language: lm.main_language || lm.language,
      type: f.type,
      release_year: f.release_year,
      episodes: f.episodes,
      total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number })
        .total_episodes,
      available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
      is_original: normalizeOriginalFlag(
        (f as Partial<FilmDoc> & { is_original?: number | boolean }).is_original
      ),
      num_cards: (f as Partial<FilmDoc> & { num_cards?: number | null }).num_cards ?? null,
      avg_difficulty_score: (f as Partial<FilmDoc> & { avg_difficulty_score?: number | null }).avg_difficulty_score ?? null,
      level_framework_stats: (f as Partial<FilmDoc> & { level_framework_stats?: string | LevelFrameworkStats[] | null }).level_framework_stats ?? null,
      is_available: (() => {
        const raw = (f as Record<string, unknown>)["is_available"];
        if (raw === null || raw === undefined) return undefined;
        if (typeof raw === 'number') return raw === 1;
        if (typeof raw === 'string') {
          const v = raw.trim();
          if (v === '1' || v.toLowerCase() === 'true') return true;
          if (v === '0' || v.toLowerCase() === 'false') return false;
        }
        if (typeof raw === 'boolean') return raw;
        return undefined;
      })(),
      imdb_score: (f as Partial<FilmDoc> & { imdb_score?: number | null }).imdb_score ?? null,
      categories: (f as Partial<FilmDoc> & { categories?: Category[] }).categories || [],
    };
    return film;
  } catch {
    return null;
  }
}

// Episode meta shape returned by /items/:slug/episodes
export interface EpisodeMetaApi {
  episode_number: number;
  title: string | null;
  slug: string;
  description: string | null;
  cover_url: string | null;
  full_audio_url: string | null;
  full_video_url: string | null;
  is_available?: boolean;
  num_cards?: number;
}

export async function apiListEpisodes(
  filmSlug: string
): Promise<EpisodeMetaApi[]> {
  try {
    const rows = await getJson<Array<Record<string, unknown>>>(
      `/items/${encodeURIComponent(filmSlug)}/episodes`
    );
    // Normalize availability flag if present
    return (rows as Array<Record<string, unknown>>).map((r) => {
      const raw = r["is_available"] as unknown;
      let is_available: boolean | undefined = undefined;
      if (raw !== null && raw !== undefined) {
        if (typeof raw === 'number') is_available = raw === 1;
        else if (typeof raw === 'string') {
          const v = raw.trim();
          if (v === '1' || v.toLowerCase() === 'true') is_available = true;
          else if (v === '0' || v.toLowerCase() === 'false') is_available = false;
        } else if (typeof raw === 'boolean') is_available = raw;
      }
      return {
        episode_number: Number(r["episode_number"]) || 1,
        title: (r["title"] as string | null) ?? null,
        slug: String(r["slug"] ?? ''),
        description: (r["description"] as string | null) ?? null,
        cover_url: (r["cover_url"] as string | null) ?? null,
        full_audio_url: (r["full_audio_url"] as string | null) ?? null,
        full_video_url: (r["full_video_url"] as string | null) ?? null,
        is_available,
        num_cards: typeof r["num_cards"] === "number" ? r["num_cards"] : Number(r["num_cards"] ?? 0),
      } as EpisodeMetaApi;
    });
  } catch {
    return [];
  }
}

export interface SRSDistribution {
  none: number;
  new: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

/**
 * Get SRS state distribution for a film
 */
export async function apiGetSRSDistribution(
  userId: string,
  filmId: string
): Promise<SRSDistribution> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    film_id: filmId,
  });

  const res = await fetch(`${API_BASE}/api/srs/distribution?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // Return default distribution (all none)
      return { none: 100, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get SRS distribution: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get saved cards count for a user and film
 */
export async function apiGetSavedCardsCount(
  userId: string,
  filmId: string
): Promise<number> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    film_id: filmId,
  });

  const res = await fetch(`${API_BASE}/api/content/saved-cards-count?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return 0;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get saved cards count: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.count || 0;
}

/**
 * Get like count for a film
 */
export async function apiGetLikeCount(filmId: string): Promise<number> {
  assertApiBase();
  const params = new URLSearchParams({
    film_id: filmId,
  });

  const res = await fetch(`${API_BASE}/api/content/like-count?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return 0;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get like count: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.count || 0;
}

/**
 * Check if user liked a film
 */
export async function apiGetLikeStatus(
  userId: string,
  filmId: string
): Promise<boolean> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    film_id: filmId,
  });

  const res = await fetch(`${API_BASE}/api/content/like-status?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return false;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get like status: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.liked || false;
}

/**
 * Toggle like status for a film
 */
export async function apiToggleLike(
  userId: string,
  filmId: string
): Promise<{ liked: boolean; like_count: number }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/content/like`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      film_id: filmId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to toggle like: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Episode Comments API
 */

export interface EpisodeComment {
  id: string;
  text: string;
  upvotes: number;
  downvotes: number;
  score: number;
  created_at: number;
  updated_at: number;
  user_id: string;
  display_name?: string;
  photo_url?: string;
}

export async function apiGetEpisodeComments(
  episodeSlug: string,
  filmSlug: string
): Promise<EpisodeComment[]> {
  assertApiBase();

  const res = await fetch(
    `${API_BASE}/api/episodes/comments?episode_slug=${encodeURIComponent(episodeSlug)}&film_slug=${encodeURIComponent(filmSlug)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get comments: ${res.status} ${text}`);
  }

  return res.json();
}

export async function apiCreateEpisodeComment(params: {
  userId: string;
  episodeSlug: string;
  filmSlug: string;
  text: string;
}): Promise<EpisodeComment> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/episodes/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: params.userId,
      episode_slug: params.episodeSlug,
      film_slug: params.filmSlug,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create comment: ${res.status} ${text}`);
  }

  return res.json();
}

export async function apiVoteEpisodeComment(params: {
  userId: string;
  commentId: string;
  voteType: 1 | -1; // 1 = upvote, -1 = downvote
}): Promise<{
  success: boolean;
  upvotes: number;
  downvotes: number;
  score: number;
  user_vote: number | null;
}> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/episodes/comments/vote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: params.userId,
      comment_id: params.commentId,
      vote_type: params.voteType,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to vote on comment: ${res.status} ${text}`);
  }

  return res.json();
}

export async function apiGetEpisodeCommentVotes(
  userId: string,
  commentIds: string[]
): Promise<Record<string, number>> {
  assertApiBase();

  if (commentIds.length === 0) {
    return {};
  }

  const res = await fetch(
    `${API_BASE}/api/episodes/comments/votes?user_id=${encodeURIComponent(userId)}&comment_ids=${encodeURIComponent(commentIds.join(','))}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get comment votes: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Save/unsave a card (toggle SRS state)
 */
export async function apiToggleSaveCard(
  userId: string,
  cardId: string,
  filmId?: string,
  episodeId?: string
): Promise<{ saved: boolean }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/card/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      card_id: cardId,
      film_id: filmId,
      episode_id: episodeId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to toggle save card: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Check if a card is saved and get SRS state
 */
export async function apiGetCardSaveStatus(
  userId: string,
  cardId: string,
  filmId?: string,
  episodeId?: string
): Promise<{ saved: boolean; srs_state: string; review_count: number }> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    card_id: cardId,
  });
  
  if (filmId) params.append('film_id', filmId);
  if (episodeId) params.append('episode_id', episodeId);

  const res = await fetch(`${API_BASE}/api/card/save-status?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { saved: false, srs_state: 'none', review_count: 0 };
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get card save status: ${res.status} ${text}`);
  }

  const data = await res.json();
  return { 
    saved: data.saved || false, 
    srs_state: data.srs_state || 'none',
    review_count: data.review_count || 0
  };
}

/**
 * Batch get save status for multiple cards (optimized to reduce API calls)
 */
export async function apiGetCardSaveStatusBatch(
  userId: string,
  cards: Array<{ card_id: string; film_id?: string; episode_id?: string }>
): Promise<Record<string, { saved: boolean; srs_state: string; review_count: number }>> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/card/save-status-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      cards: cards,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Failed to get batch card save status: ${res.status} ${text}`);
    // Return default values for all cards on error
    const result: Record<string, { saved: boolean; srs_state: string; review_count: number }> = {};
    cards.forEach(card => {
      result[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
    });
    return result;
  }

  const data = await res.json();
  return data;
}

/**
 * Increment review count for a card
 */
export async function apiIncrementReviewCount(
  userId: string,
  cardId: string,
  filmId?: string,
  episodeId?: string
): Promise<{ review_count: number }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/card/increment-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      card_id: cardId,
      film_id: filmId,
      episode_id: episodeId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to increment review count: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Update SRS state for a card
 */
export async function apiUpdateCardSRSState(
  userId: string,
  cardId: string,
  srsState: string,
  filmId?: string,
  episodeId?: string
): Promise<{ success: boolean; srs_state: string }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/card/srs-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      card_id: cardId,
      film_id: filmId,
      episode_id: episodeId,
      srs_state: srsState,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update SRS state: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get list of saved cards for a user
 */
export async function apiGetSavedCards(
  userId: string,
  page: number = 1,
  limit: number = 50
): Promise<{
  cards: Array<CardDoc & { srs_state: string; film_title?: string }>;
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    page: String(page),
    limit: String(limit),
  });

  const res = await fetch(`${API_BASE}/api/user/saved-cards?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get saved cards: ${res.status} ${text}`);
  }

  return res.json();
}

export async function apiFetchCardsForFilm(
  filmId: string,
  episodeId?: string,
  max: number = 50,
  opts?: { startFrom?: number; excludeSavedForUser?: string }
): Promise<CardDoc[]> {
  // Always encode parts to support non-ASCII slugs (e.g., Vietnamese)
  const filmEnc = encodeURIComponent(filmId);
  // Aggressive cache busting to bypass stale Cloudflare edge cache
  const cacheBust = `v=${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  const q = new URLSearchParams();
  q.set('limit', String(max));
  if (opts?.startFrom != null && Number.isFinite(opts.startFrom)) {
    q.set('start_from', String(Math.max(0, Math.floor(opts.startFrom))));
  }
  if (opts?.excludeSavedForUser) {
    q.set('exclude_saved_for_user', opts.excludeSavedForUser);
  }
  q.set('v', cacheBust);
  const basePath = episodeId
    ? `/items/${filmEnc}/episodes/${encodeURIComponent(episodeId)}/cards?${q.toString()}`
    : `/items/${filmEnc}/cards?${q.toString()}`;
  const rows = await getJson<Array<Record<string, unknown>>>(basePath);
  
  return rows.map(rowToCardDoc);
}

export async function apiFetchAllCards(limit = 1000): Promise<CardDoc[]> {
  const rows = await getJson<Array<Record<string, unknown>>>(
    `/cards?limit=${limit}`
  );
  return rows.map(rowToCardDoc);
}

// Full-text search via Worker /search (FTS5) with response caching on client
// Caches results by query hash to avoid duplicate requests
const searchCache = new Map<string, { data: CardDoc[]; timestamp: number }>();
const SEARCH_CACHE_TTL = 60000; // 60 seconds

function getSearchCacheKey(params: Record<string, unknown>): string {
  const key = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return key;
}

export async function apiSearchCardsFTS(params: {
  q: string;
  limit?: number;
  mainLanguage?: string | null;
  subtitleLanguages?: string[];
  contentIds?: string[];
  minDifficulty?: number;
  maxDifficulty?: number;
  minLevel?: string | null;
  maxLevel?: string | null;
  minLength?: number;
  maxLength?: number;
  maxDuration?: number;
  minReview?: number;
  maxReview?: number;
  userId?: string | null;
}): Promise<CardDoc[]> {
  const perfStart = performance.now();
  const { q, contentIds, subtitleLanguages, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, userId } = params;
  const limit = params.limit ?? 100;
  const main = params.mainLanguage ? `&main=${encodeURIComponent(params.mainLanguage)}` : "";
  const contentIdsParam =
    contentIds && contentIds.length ? `&content_ids=${encodeURIComponent(contentIds.join(','))}` : '';
  const subtitleLangsParam =
    subtitleLanguages && subtitleLanguages.length
      ? `&subtitle_languages=${encodeURIComponent(subtitleLanguages.join(','))}`
      : '';
  const difficultyMinParam = minDifficulty !== undefined && minDifficulty !== null ? `&difficulty_min=${minDifficulty}` : '';
  const difficultyMaxParam = maxDifficulty !== undefined && maxDifficulty !== null ? `&difficulty_max=${maxDifficulty}` : '';
  const levelMinParam = minLevel ? `&level_min=${encodeURIComponent(minLevel)}` : '';
  const levelMaxParam = maxLevel ? `&level_max=${encodeURIComponent(maxLevel)}` : '';
  const lengthMinParam = minLength !== undefined && minLength !== null ? `&length_min=${minLength}` : '';
  const lengthMaxParam = maxLength !== undefined && maxLength !== null ? `&length_max=${maxLength}` : '';
  const durationMaxParam = maxDuration !== undefined && maxDuration !== null ? `&duration_max=${maxDuration}` : '';
  const reviewMinParam = minReview !== undefined && minReview !== null ? `&review_min=${minReview}` : '';
  const reviewMaxParam = maxReview !== undefined && maxReview !== null ? `&review_max=${maxReview}` : '';
  const userIdParam = userId ? `&user_id=${encodeURIComponent(userId)}` : '';

  // Check cache first (short TTL)
  const cacheKey = getSearchCacheKey(params);
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    const cacheTime = performance.now() - perfStart;
    console.log(`[apiSearchCardsFTS] Cache hit in ${cacheTime.toFixed(2)}ms`);
    return cached.data;
  }
  
  const fetchStart = performance.now();
  const rows = await getJson<Array<Record<string, unknown>>>(
    `/search?q=${encodeURIComponent(q)}&limit=${limit}${main}${contentIdsParam}${subtitleLangsParam}${difficultyMinParam}${difficultyMaxParam}${levelMinParam}${levelMaxParam}${lengthMinParam}${lengthMaxParam}${durationMaxParam}${reviewMinParam}${reviewMaxParam}${userIdParam}`
  );
  const fetchTime = performance.now() - fetchStart;
  
  const mapStart = performance.now();
  const result = rows.map(rowToCardDoc);
  const mapTime = performance.now() - mapStart;
  
  searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
  
  const totalTime = performance.now() - perfStart;
  console.log(`[apiSearchCardsFTS] Total: ${totalTime.toFixed(2)}ms (fetch: ${fetchTime.toFixed(2)}ms, map: ${mapTime.toFixed(2)}ms), returned ${result.length} items`);
  
  return result;
}

/**
 * Get autocomplete suggestions from search_terms table
 */
export async function apiSearchAutocomplete(params: {
  q: string;
  language?: string | null;
  limit?: number;
}): Promise<{ suggestions: Array<{ term: string; frequency: number; language: string | null }> }> {
  assertApiBase();
  const { q, language, limit = 10 } = params;
  
  const urlParams = new URLSearchParams();
  urlParams.set('q', q);
  if (language) {
    urlParams.set('language', language);
  }
  if (limit !== 10) {
    urlParams.set('limit', String(limit));
  }

  const res = await fetch(`${API_BASE}/api/search/autocomplete?${urlParams}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get autocomplete suggestions: ${res.status} ${text}`);
  }

  return res.json();
}

// New autocomplete endpoint for content/film titles (replaces search_terms based autocomplete)
export async function apiContentAutocomplete(params: {
  q: string;
  limit?: number;
}): Promise<{ suggestions: Array<{ term: string; slug: string }> }> {
  assertApiBase();
  const { q, limit = 10 } = params;
  
  const urlParams = new URLSearchParams();
  urlParams.set('q', q);
  if (limit !== 10) {
    urlParams.set('limit', String(limit));
  }

  const res = await fetch(`${API_BASE}/api/content/autocomplete?${urlParams}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get content autocomplete: ${res.status} ${text}`);
  }

  return res.json();
}

// New unified search API endpoint (paginated with main_language + subtitle_languages filters)
export async function apiSearch(params: {
  query?: string;
  page?: number;
  size?: number;
  mainLanguage?: string | null;
  subtitleLanguages?: string[];
  contentIds?: string[];
  minDifficulty?: number;
  maxDifficulty?: number;
  minLevel?: string | null;
  maxLevel?: string | null;
  minLength?: number;
  maxLength?: number;
  maxDuration?: number;
  minReview?: number;
  maxReview?: number;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<{ items: CardDoc[]; total: number; page: number; size: number }> {
  const perfStart = performance.now();
  const query = params.query || '';
  const page = params.page ?? 1;
  const size = params.size ?? 50;
  
  const urlParams = new URLSearchParams();
  urlParams.set('q', query);
  urlParams.set('page', String(page));
  urlParams.set('size', String(size));
  
  if (params.mainLanguage) {
    urlParams.set('main_language', params.mainLanguage);
  }
  
  if (params.subtitleLanguages && params.subtitleLanguages.length > 0) {
    urlParams.set('subtitle_languages', params.subtitleLanguages.join(','));
  }
  
  if (params.contentIds && params.contentIds.length > 0) {
    urlParams.set('content_ids', params.contentIds.join(','));
  }
  
  if (params.minDifficulty !== undefined && params.minDifficulty !== null) {
    urlParams.set('difficulty_min', String(params.minDifficulty));
  }
  
  if (params.maxDifficulty !== undefined && params.maxDifficulty !== null) {
    urlParams.set('difficulty_max', String(params.maxDifficulty));
  }
  
  if (params.minLevel) {
    urlParams.set('level_min', params.minLevel);
  }
  
  if (params.maxLevel) {
    urlParams.set('level_max', params.maxLevel);
  }
  
  if (params.minLength !== undefined && params.minLength !== null && params.minLength > 1) {
    urlParams.set('length_min', String(params.minLength));
  }
  
  if (params.maxLength !== undefined && params.maxLength !== null && params.maxLength < 1000) {
    urlParams.set('length_max', String(params.maxLength));
  }
  
  if (params.maxDuration !== undefined && params.maxDuration !== null && params.maxDuration < 300) {
    urlParams.set('duration_max', String(params.maxDuration));
  }
  
  if (params.minReview !== undefined && params.minReview !== null && params.minReview > 0) {
    urlParams.set('review_min', String(params.minReview));
  }
  
  if (params.maxReview !== undefined && params.maxReview !== null && params.maxReview < 10000) {
    urlParams.set('review_max', String(params.maxReview));
  }
  
  if (params.userId) {
    urlParams.set('user_id', params.userId);
  }
  
  assertApiBase();
  const fullUrl = `${API_BASE}/api/search?${urlParams.toString()}`;
  
  const fetchStart = performance.now();
  const res = await fetch(fullUrl, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  });
  
  if (!res.ok) {
    const fetchTime = performance.now() - fetchStart;
    console.error(`[apiSearch] API failed after ${fetchTime.toFixed(2)}ms: ${res.status}`);
    throw new Error(`Search API failed: ${res.status}`);
  }
  
  const jsonStart = performance.now();
  const data = await res.json();
  const jsonTime = performance.now() - jsonStart;
  
  // Map API response to CardDoc
  const mapStart = performance.now();
  
  // Helper to build media URL from key or URL
  const buildMediaUrlFromResponse = (
    url: string | undefined,
    key: string | undefined,
    filmId: string,
    episodeId: string,
    cardId: string,
    type: "audio" | "image"
  ): string => {
    if (url) return url;
    if (key) {
      if (/^https?:\/\//i.test(key)) return key;
      if (key.includes("/")) {
        return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : `/${key}`;
      }
      // simple filename: synthesize full path using new convention
      const ext = type === "image" ? "jpg" : "mp3";
      let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
      if (!epNum || Number.isNaN(epNum)) {
        const m = String(episodeId || "").match(/_(\d+)$/);
        epNum = m ? Number(m[1]) : 1;
      }
      const epPadded = String(epNum).padStart(3, "0");
      const isDigits = /^[0-9]+$/.test(String(cardId));
      const cardPadded = isDigits ? String(cardId).padStart(4, "0") : String(cardId);
      const rel = `items/${filmId}/episodes/${filmId}_${epPadded}/${type}/${filmId}_${epPadded}_${cardPadded}.${ext}`;
      return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${rel}` : `/${rel}`;
    }
    // fallback: build from card data
    const ext = type === "image" ? "jpg" : "mp3";
    let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
    if (!epNum || Number.isNaN(epNum)) {
      const m = String(episodeId || "").match(/_(\d+)$/);
      epNum = m ? Number(m[1]) : 1;
    }
    const epPadded = String(epNum).padStart(3, "0");
    const isDigits = /^[0-9]+$/.test(String(cardId));
    const cardPadded = isDigits ? String(cardId).padStart(4, "0") : String(cardId);
    const rel = `items/${filmId}/episodes/${filmId}_${epPadded}/${type}/${filmId}_${epPadded}_${cardPadded}.${ext}`;
    return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${rel}` : `/${rel}`;
  };
  
  const items: CardDoc[] = (data.items || []).map((r: Record<string, unknown>) => {
    const cardId = String(r.card_id || '');
    const filmId = String(r.content_slug || '');
    const episodeId = String(r.episode_slug || '');
    
    const imageUrl = buildMediaUrlFromResponse(
      r.image_url as string | undefined,
      r.image_key as string | undefined,
      filmId,
      episodeId,
      cardId,
      "image"
    );
    const audioUrl = buildMediaUrlFromResponse(
      r.audio_url as string | undefined,
      r.audio_key as string | undefined,
      filmId,
      episodeId,
      cardId,
      "audio"
    );
    
    return {
      id: cardId,
      film_id: filmId,
      episode_id: episodeId,
      episode: Number(r.episode_number || 0),
      image_url: imageUrl,
      audio_url: audioUrl,
      start: Number(r.start_time || 0),
      end: Number(r.end_time || 0),
      difficulty_score: r.difficulty_score,
      sentence: r.text || '',
      subtitle: r.subtitle || {},
      levels: (() => {
        const levelsRaw = r.levels;
        if (!levelsRaw) return undefined;
        if (Array.isArray(levelsRaw)) {
          return levelsRaw.map((l: unknown) => {
            if (l && typeof l === 'object' && 'framework' in l && 'level' in l) {
              return {
                framework: String((l as Record<string, unknown>).framework || ''),
                level: String((l as Record<string, unknown>).level || ''),
                language: (l as Record<string, unknown>).language ? String((l as Record<string, unknown>).language) : undefined
              };
            }
            return null;
          }).filter(Boolean) as Array<{ framework: string; level: string; language?: string }>;
        }
        return undefined;
      })(),
    };
  });
  const mapTime = performance.now() - mapStart;
  
  const totalTime = performance.now() - perfStart;
  const fetchTime = performance.now() - fetchStart;
  console.log(`[apiSearch] Total: ${totalTime.toFixed(2)}ms (fetch: ${fetchTime.toFixed(2)}ms, json: ${jsonTime.toFixed(2)}ms, map: ${mapTime.toFixed(2)}ms), returned ${items.length} items (total: ${data.total || 0})`);
  
  return {
    items,
    total: data.total || 0,
    page: data.page || page,
    size: data.size || size,
  };
}

export async function apiSearchCounts(params: {
  mainLanguage?: string | null;
  subtitleLanguages?: string[];
  query?: string;
  contentIds?: string[];
  minDifficulty?: number;
  maxDifficulty?: number;
  minLevel?: string | null;
  maxLevel?: string | null;
  minLength?: number;
  maxLength?: number;
  maxDuration?: number;
  minReview?: number;
  maxReview?: number;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<Record<string, number>> {
  const urlParams = new URLSearchParams();

  if (params.mainLanguage) {
    urlParams.set('main_language', params.mainLanguage);
  }

  if (params.subtitleLanguages && params.subtitleLanguages.length > 0) {
    urlParams.set('subtitle_languages', params.subtitleLanguages.join(','));
  }
  
  if (params.minDifficulty !== undefined && params.minDifficulty !== null) {
    urlParams.set('difficulty_min', String(params.minDifficulty));
  }
  
  if (params.maxDifficulty !== undefined && params.maxDifficulty !== null) {
    urlParams.set('difficulty_max', String(params.maxDifficulty));
  }
  
  if (params.minLevel) {
    urlParams.set('level_min', params.minLevel);
  }
  
  if (params.maxLevel) {
    urlParams.set('level_max', params.maxLevel);
  }
  
  if (params.minLength !== undefined && params.minLength !== null) {
    urlParams.set('length_min', String(params.minLength));
  }
  
  if (params.maxLength !== undefined && params.maxLength !== null) {
    urlParams.set('length_max', String(params.maxLength));
  }
  
  if (params.maxDuration !== undefined && params.maxDuration !== null) {
    urlParams.set('duration_max', String(params.maxDuration));
  }
  
  if (params.minReview !== undefined && params.minReview !== null) {
    urlParams.set('review_min', String(params.minReview));
  }
  
  if (params.maxReview !== undefined && params.maxReview !== null) {
    urlParams.set('review_max', String(params.maxReview));
  }
  
  if (params.userId) {
    urlParams.set('user_id', params.userId);
  }

  if (params.query && params.query.trim().length > 0) {
    urlParams.set('q', params.query.trim());
  }

  if (params.contentIds && params.contentIds.length > 0) {
    urlParams.set('content_ids', params.contentIds.join(','));
  }

  assertApiBase();
  const fullUrl = `${API_BASE}/api/search/counts?${urlParams.toString()}`;
  const res = await fetch(fullUrl, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  });
  
  if (!res.ok) {
    throw new Error(`Search counts API failed: ${res.status}`);
  }
  
  const data = await res.json();
  return data.counts || {};
}

export async function apiGetCardByPath(
  filmId: string,
  episodeId: string,
  cardId: string
): Promise<CardDoc | null> {
  try {
    const row = await getJson<Record<string, unknown>>(
      `/cards/${encodeURIComponent(filmId)}/${encodeURIComponent(
        episodeId
      )}/${encodeURIComponent(cardId)}`
    );
    return rowToCardDoc(row);
  } catch {
    return null;
  }
}

// Delete a single card and its media
export async function apiDeleteCard(params: {
  filmSlug: string;
  episodeSlug: string; // accepts e1 or slug_001
  cardId: string; // display id e.g. 0001
}): Promise<
  | { ok: true; deleted: string; media_deleted: number; media_errors: string[] }
  | { error: string }
> {
  assertApiBase();
  const { filmSlug, episodeSlug, cardId } = params;
  const res = await fetch(
    `${API_BASE}/cards/${encodeURIComponent(filmSlug)}/${encodeURIComponent(episodeSlug)}/${encodeURIComponent(cardId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Card delete failed: ${res.status} ${text}` };
  }
  try {
    const body = await res.json();
    if (body && body.ok) {
      return {
        ok: true,
        deleted: body.deleted,
        media_deleted: body.media_deleted || 0,
        media_errors: Array.isArray(body.media_errors) ? body.media_errors : [],
      };
    }
    return { error: 'Unexpected delete response' };
  } catch {
    return { error: 'Malformed delete response' };
  }
}

// Get an episode detail with stats
export async function apiGetEpisodeDetail(params: {
  filmSlug: string;
  episodeNum: number;
}): Promise<EpisodeDetailDoc | null> {
  try {
    const { filmSlug, episodeNum } = params;
    const epSlug = `${filmSlug}_${episodeNum}`;
    const row = await getJson<EpisodeDetailDoc>(
      `/items/${encodeURIComponent(filmSlug)}/episodes/${encodeURIComponent(epSlug)}`
    );
    return row as EpisodeDetailDoc;
  } catch {
    return null;
  }
}

// Signed upload to R2: ask the Worker for a signed URL, then PUT the bytes.
export async function r2UploadViaSignedUrl(params: {
  bucketPath: string;
  file: File;
  contentType?: string;
  timeoutMs?: number; // optional per-upload timeout (aborts PUT if exceeded)
}) {
  assertApiBase();
  const { bucketPath, file } = params;
  const ct = params.contentType || file.type || "application/octet-stream";
  // Optional short timeout for signing
  const signController = new AbortController();
  const signTimer = setTimeout(() => signController.abort(), 30000);
  const signRes = await fetch(`${API_BASE}/r2/sign-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: bucketPath, contentType: ct }),
    signal: signController.signal,
  }).finally(() => clearTimeout(signTimer));
  if (!signRes.ok) {
    throw new Error(`Failed to get signed URL: ${signRes.status}`);
  }
  const { url } = (await signRes.json()) as { url: string };
  const putController = new AbortController();
  const timeout = Math.max(10000, params.timeoutMs ?? 120000); // default 120s
  const putTimer = setTimeout(() => putController.abort(), timeout);
  const put = await fetch(url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": ct },
    signal: putController.signal,
  }).finally(() => clearTimeout(putTimer));
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
}

// Multipart upload for large files (video)
export async function r2MultipartInit(params: { key: string; contentType?: string }) {
  assertApiBase();
  const res = await fetch(`${API_BASE}/r2/multipart/init`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params)
  });
  if (!res.ok) throw new Error(`Multipart init failed: ${res.status}`);
  return await res.json() as { uploadId: string; key: string };
}

export async function r2MultipartUploadPart(params: { key: string; uploadId: string; partNumber: number; data: Blob }) {
  assertApiBase();
  const q = new URLSearchParams({ key: params.key, uploadId: params.uploadId, partNumber: String(params.partNumber) });
  const res = await fetch(`${API_BASE}/r2/multipart/part?${q.toString()}`, { method: 'PUT', body: params.data });
  if (!res.ok) throw new Error(`Upload part ${params.partNumber} failed: ${res.status}`);
  return await res.json() as { etag: string; partNumber: number };
}

export async function r2MultipartComplete(params: { key: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> }) {
  assertApiBase();
  const res = await fetch(`${API_BASE}/r2/multipart/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`Multipart complete failed: ${res.status}`);
  return await res.json() as { ok: true; key: string };
}

export async function r2MultipartAbort(params: { key: string; uploadId: string }) {
  assertApiBase();
  const res = await fetch(`${API_BASE}/r2/multipart/abort`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`Multipart abort failed: ${res.status}`);
}

export async function r2MultipartUpload(params: {
  key: string; file: File; contentType?: string; partSizeBytes?: number; concurrency?: number; onProgress?: (doneBytes: number, totalBytes: number) => void;
}) {
  const { key, file } = params;
  const contentType = params.contentType || file.type || 'application/octet-stream';
  const partSize = Math.max(5 * 1024 * 1024, params.partSizeBytes ?? 8 * 1024 * 1024); // min 5MB
  const concurrency = Math.max(1, params.concurrency ?? 3);
  const total = file.size;
  const totalParts = Math.ceil(total / partSize);
  const { uploadId } = await r2MultipartInit({ key, contentType });
  let completedBytes = 0;
  const parts: Array<{ partNumber: number; etag: string }> = [];

  const queue: Array<{ partNumber: number; start: number; end: number }> = [];
  for (let i = 0; i < totalParts; i++) {
    const start = i * partSize; const end = Math.min(total, start + partSize);
    queue.push({ partNumber: i + 1, start, end });
  }

  async function worker() {
    while (queue.length) {
      const item = queue.shift()!;
      const blob = file.slice(item.start, item.end);
      // retry each part a few times for robustness
      let attempts = 0; let lastErr: unknown = null;
      while (attempts < 3) {
        try {
          const { etag } = await r2MultipartUploadPart({ key, uploadId, partNumber: item.partNumber, data: blob });
          parts[item.partNumber - 1] = { partNumber: item.partNumber, etag };
          completedBytes += blob.size;
          params.onProgress?.(completedBytes, total);
          break;
        } catch (e) {
          lastErr = e; attempts++;
          if (attempts >= 3) throw lastErr;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, totalParts) }, () => worker());
  try {
    await Promise.all(workers);
  } catch (e) {
    try { await r2MultipartAbort({ key, uploadId }); } catch (abortErr) { void abortErr; }
    throw e;
  }
  await r2MultipartComplete({ key, uploadId, parts: parts.filter(Boolean) as Array<{ partNumber: number; etag: string }> });
}

// Batch sign upload: request multiple signed URLs in a single API call
// Dramatically reduces round-trips for bulk uploads (1000 files: 1000 requests → ~10 batched)
export async function r2BatchSignUpload(items: Array<{ path: string; contentType?: string }>): Promise<Array<{ path: string; url: string }>> {
  assertApiBase();
  if (!items.length) return [];
  const signRes = await fetch(`${API_BASE}/r2/sign-upload-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!signRes.ok) {
    throw new Error(`Batch sign failed: ${signRes.status}`);
  }
  const { urls } = (await signRes.json()) as { urls: Array<{ path: string; url: string }> };
  return urls;
}

// Import CSV-processed payload into D1 via Worker
export interface ImportPayload {
  // allow extra film fields (e.g., episode_title) to flow through
  film: (FilmDoc & { slug?: string }) & Record<string, unknown>; // slug used externally, id may be UUID internally
  episodeNumber: number; // numeric episode
  cards: Array<Partial<CardDoc> & { id?: string; card_number?: number }>;
  mode?: "replace" | "append";
}

export async function apiImport(payload: ImportPayload) {
  assertApiBase();
  const res = await fetch(`${API_BASE}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface server-side error detail for easier debugging
    throw new Error(`Import failed: ${res.status} ${text}`);
  }
  return await res.json().catch(() => ({}));
}

// Categories API
export async function apiListCategories(): Promise<Category[]> {
  assertApiBase();
  const res = await getJson<{ categories: Category[] }>('/categories');
  return res.categories || [];
}

export async function apiCreateCategory(name: string): Promise<Category & { created: boolean }> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Create category failed: ${res.status} ${text}`);
  }
  return await res.json();
}

export async function apiUpdateCategory(id: string, name: string): Promise<Category> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Update category failed: ${res.status} ${text}`);
  }
  return await res.json();
}

export async function apiCheckCategoryUsage(id: string): Promise<{ category_id: string; usage_count: number }> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(id)}/usage`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Check category usage failed: ${res.status} ${text}`);
  }
  return await res.json();
}

export async function apiDeleteCategory(id: string): Promise<{ ok: boolean; deleted: string }> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const errorData = await res.json().catch(() => ({ error: text }));
    throw new Error(errorData.error || `Delete category failed: ${res.status} ${text}`);
  }
  return await res.json();
}

export async function apiGetContentCategories(filmSlug: string): Promise<Category[]> {
  assertApiBase();
  const res = await getJson<{ categories: Category[] }>(`/items/${encodeURIComponent(filmSlug)}/categories`);
  return res.categories || [];
}

// Update film meta (title, description, cover)
export async function apiUpdateFilmMeta(params: {
  filmSlug: string;
  title?: string | null;
  description?: string | null;
  cover_url?: string | null;
  cover_landscape_url?: string | null;
  total_episodes?: number | null;
  type?: string | null;
  release_year?: number | null;
  is_original?: boolean | null;
  is_available?: boolean | number | null;
  video_has_images?: boolean | number | null;
  imdb_score?: number | null;
  category_ids?: string[] | null;
}) {
  assertApiBase();
  const { filmSlug, ...body } = params;
  const res = await fetch(`${API_BASE}/items/${encodeURIComponent(filmSlug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Update meta failed: ${res.status} ${text}`);
  }
}

// Update episode meta (title, full audio/video)
export async function apiUpdateEpisodeMeta(params: {
  filmSlug: string;
  episodeNum: number;
  title?: string;
  description?: string;
  cover_url?: string;
  cover_key?: string;
  full_audio_url?: string;
  full_audio_key?: string;
  full_video_url?: string;
  full_video_key?: string;
  is_available?: boolean | number;
}) {
  assertApiBase();
  const { filmSlug, episodeNum, ...body } = params;
  const epSlug = `${filmSlug}_${episodeNum}`;
  const res = await fetch(
    `${API_BASE}/items/${encodeURIComponent(
      filmSlug
    )}/episodes/${encodeURIComponent(epSlug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Update episode meta failed: ${res.status} ${text}`);
  }
}

// Calculate statistics (num_cards, avg_difficulty_score, level distributions)
export async function apiCalculateStats(params: {
  filmSlug: string;
  episodeNum: number;
}): Promise<{ ok: true } | { error: string }> {
  assertApiBase();
  const { filmSlug, episodeNum } = params;
  const epSlug = `${filmSlug}_${String(episodeNum).padStart(3, '0')}`;
  const res = await fetch(
    `${API_BASE}/items/${encodeURIComponent(filmSlug)}/episodes/${encodeURIComponent(epSlug)}/calc-stats`,
    { method: "POST" }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Stats calc failed: ${res.status} ${text}` } as { error: string };
  }
  try {
    await res.json();
  } catch {
    // ignore non-JSON bodies
  }
  return { ok: true } as { ok: true };
}

// Delete a content item (and cascade its episodes/cards via backend)
export async function apiDeleteItem(filmSlug: string): Promise<
  | { ok: true; deleted: string; episodes_deleted: number; cards_deleted: number; media_deleted: number; media_errors: string[] }
  | { error: string }
> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/items/${encodeURIComponent(filmSlug)}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Delete failed: ${res.status} ${text}` };
  }
  try {
    const body = await res.json();
    if (body && body.ok) {
      return {
        ok: true,
        deleted: body.deleted,
        episodes_deleted: body.episodes_deleted || 0,
        cards_deleted: body.cards_deleted || 0,
        media_deleted: body.media_deleted || 0,
        media_errors: Array.isArray(body.media_errors) ? body.media_errors : [],
      };
    }
    return { error: 'Unexpected delete response' };
  } catch {
    return { error: 'Malformed delete response' };
  }
}

// Delete a specific episode (cascade cards + media)
export async function apiDeleteEpisode(params: {
  filmSlug: string;
  episodeNum: number;
}): Promise<
  | { ok: true; deleted: string; cards_deleted: number; media_deleted: number; media_errors: string[] }
  | { error: string }
> {
  assertApiBase();
  const { filmSlug, episodeNum } = params;
  const epSlug = `${filmSlug}_${episodeNum}`;
  const res = await fetch(
    `${API_BASE}/items/${encodeURIComponent(filmSlug)}/episodes/${encodeURIComponent(epSlug)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Episode delete failed: ${res.status} ${text}` };
  }
  try {
    const body = await res.json();
    if (body && body.ok) {
      return {
        ok: true,
        deleted: body.deleted,
        cards_deleted: body.cards_deleted || 0,
        media_deleted: body.media_deleted || 0,
        media_errors: Array.isArray(body.media_errors) ? body.media_errors : [],
      };
    }
    return { error: 'Unexpected delete response' };
  } catch {
    return { error: 'Malformed delete response' };
  }
}

// R2 object listing and deletion
export interface R2ItemApi {
  key: string;
  name: string;
  type: 'directory' | 'file';
  size?: number | string | null;
  modified?: string | null;
  url?: string;
}

export async function apiR2List(prefix: string = ""): Promise<R2ItemApi[]> {
  const enc = encodeURIComponent(prefix);
  return await getJson<R2ItemApi[]>(`/r2/list?prefix=${enc}`);
}

export interface R2PagedListResponse {
  items: R2ItemApi[];
  cursor: string | null;
  truncated: boolean;
}
export async function apiR2ListPaged(prefix: string = "", cursor?: string | null, limit: number = 50): Promise<R2PagedListResponse> {
  const params = new URLSearchParams({ prefix, paged: '1', limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return await getJson<R2PagedListResponse>(`/r2/list?${params.toString()}`);
}

// Flat paginated list for recursive operations
export interface R2FlatPage {
  objects: Array<{ key: string; size?: number; modified?: string | null }>;
  cursor: string | null;
  truncated: boolean;
}
export async function apiR2ListFlatPage(prefix: string, cursor?: string | null, limit: number = 1000): Promise<R2FlatPage> {
  const q = new URLSearchParams({ prefix, flat: '1', limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  return await getJson<R2FlatPage>(`/r2/list?${q.toString()}`);
}

export async function apiR2Delete(key: string, opts?: { recursive?: boolean; concurrency?: number }): Promise<{ ok: true } | { error: string }> {
  assertApiBase();
  const q = new URLSearchParams({ key });
  if (opts?.recursive) q.set('recursive', '1');
  if (opts?.concurrency) q.set('c', String(opts.concurrency));
  const res = await fetch(`${API_BASE}/r2/delete?${q.toString()}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Delete failed: ${res.status} ${text}` };
  }
  try {
    const body = await res.json();
    if (body && body.ok) return { ok: true } as const;
    return { error: 'Unexpected delete response' };
  } catch {
    return { error: 'Malformed delete response' };
  }
}

// Helper to convert a normalized API row into CardDoc
function rowToCardDoc(r: Record<string, unknown>): CardDoc {
  // Expect fields: card_id or id, episode_id, film_id?, start_time_ms, end_time_ms, audio_key, image_key, subtitles? or subtitle map.
  const get = (k: string): unknown => r[k];
  const id = String(get("id") ?? get("card_id") ?? "");
  const episodeId = String(get("episode_id") ?? get("episode") ?? "e1");
  const filmIdVal = get("film_id");
  const filmId = filmIdVal != null ? String(filmIdVal) : undefined;
  const startMs = Number(
    get("start_time_ms") ?? get("start_time") ?? get("start_ms") ?? get("start") ?? 0
  );
  const endMs = Number(
    get("end_time_ms") ?? get("end_time") ?? get("end_ms") ?? get("end") ?? 0
  );
  // Worker returns seconds directly in 'start' and 'end' fields; no conversion needed
  const start = startMs;
  const end = endMs;
  let subCandidate = (get("subtitle") ?? get("subtitles")) as unknown;
  
  // Handle common shapes:
  // - Array of { language, text }
  // - Object map { lang: text }
  // - JSON string for either of the above (legacy)
  if (typeof subCandidate === 'string') {
    try {
      const parsed = JSON.parse(subCandidate);
      subCandidate = parsed as unknown;
    } catch {
      // if malformed string, treat as empty
      subCandidate = {} as Record<string, string>;
    }
  }
  const subtitle: Record<string, string> = Array.isArray(subCandidate)
    ? (subCandidate as Array<Record<string, unknown>>).reduce(
        (acc: Record<string, string>, row: Record<string, unknown>) => {
          const lang = row["language"];
          const text = row["text"];
          if (typeof lang === "string" && typeof text === "string") {
            acc[lang] = text;
          }
          return acc;
        },
        {}
      )
    : ((subCandidate as Record<string, string>) || {});
  // Build media URLs: if audio_key/image_key are full URLs use them; otherwise treat as bucket paths relative to R2_PUBLIC_BASE
  const audioUrl = buildMediaUrlFromKey(
    (get("audio_url") as string | undefined) || (get("audio_key") as string | undefined),
    filmId,
    episodeId,
    id,
    "audio"
  );
  const imageUrl = buildMediaUrlFromKey(
    (get("image_url") as string | undefined) || (get("image_key") as string | undefined),
    filmId,
    episodeId,
    id,
    "image"
  );
  return {
    id,
    episode: episodeId,
    episode_id: episodeId,
    start,
    end,
    duration: typeof get("duration") === "number" ? (get("duration") as number) : undefined,
    audio_url: audioUrl,
    image_url: imageUrl,
    subtitle,
    film_id: filmId,
    sentence: (get("sentence") as string | undefined),
    CEFR_Level:
      ((get("CEFR_Level") as string | undefined) ||
        (get("cefr") as string | undefined) ||
        (get("cefr_level") as string | undefined)) as
        | string
        | undefined,
    words: (() => {
      const w = get("words");
      if (w && typeof w === "object" && !Array.isArray(w)) {
        return w as Record<string, string>;
      }
      if (typeof w === "string") {
        try {
          const parsed = JSON.parse(w);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, string>;
          }
        } catch {
          // ignore malformed JSON in words field
        }
      }
      return undefined;
    })(),
    difficulty_score:
      typeof get("difficulty_score") === "number"
        ? (get("difficulty_score") as number)
        : undefined,
    is_available: (() => {
      const raw = get("is_available");
      if (raw === null || raw === undefined) return undefined; // allow defaulting logic (?? true) in callers
      if (typeof raw === 'number') return raw === 1;
      if (typeof raw === 'string') {
        const v = raw.trim();
        if (v === '1' || v.toLowerCase() === 'true') return true;
        if (v === '0' || v.toLowerCase() === 'false') return false;
      }
      if (typeof raw === 'boolean') return raw;
      return undefined;
    })(),
    levels: (() => {
      const levelsRaw = get("levels");
      if (!levelsRaw) return undefined;
      if (Array.isArray(levelsRaw)) {
        return levelsRaw.map((l: unknown) => {
          if (l && typeof l === 'object' && 'framework' in l && 'level' in l) {
            const levelObj = l as Record<string, unknown>;
            return {
              framework: String(levelObj.framework || ''),
              level: String(levelObj.level || ''),
              language: levelObj.language ? String(levelObj.language) : undefined
            };
          }
          return null;
        }).filter(Boolean) as Array<{ framework: string; level: string; language?: string }>;
      }
      return undefined;
    })(),
  };
}

function buildMediaUrlFromKey(
  key: string | undefined,
  filmId: string | undefined,
  episodeId: string,
  cardId: string,
  type: "audio" | "image"
): string {
  if (!key) {
    return buildR2MediaUrl({ filmId: filmId || "", episodeId, cardId, type });
  }
  if (/^https?:\/\//i.test(key)) return key;
  if (key.includes("/")) {
    // If existing objects still under films/, return them directly; new ones under items/
    return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : `/${key}`;
  }
  // simple filename (no path): synthesize full path using new convention
  if (!filmId) {
    return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : `/${key}`;
  }
  const ext = type === "image" ? "jpg" : "mp3";
  let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
  if (!epNum || Number.isNaN(epNum)) {
    const m = String(episodeId || "").match(/_(\d+)$/);
    epNum = m ? Number(m[1]) : 1;
  }
  const epPadded = String(epNum).padStart(3, "0");
  const isDigits = /^[0-9]+$/.test(String(cardId));
  const cardPadded = isDigits ? String(cardId).padStart(4, "0") : String(cardId);
  const rel = `items/${filmId}/episodes/${filmId}_${epPadded}/${type}/${filmId}_${epPadded}_${cardPadded}.${ext}`;
  return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${rel}` : `/${rel}`;
}

// ==================== USER MANAGEMENT ====================

export interface UserProfile {
  id: string;
  email?: string;
  display_name?: string;
  photo_url?: string;
  auth_provider?: string;
  is_active?: number;
  is_admin?: number;
  role?: string;
  created_at?: number;
  updated_at?: number;
  last_login_at?: number;
  // From preferences join
  main_language?: string;
  subtitle_languages?: string;
  require_all_languages?: number;
  difficulty_min?: number;
  difficulty_max?: number;
  auto_play?: number;
  playback_speed?: number;
  theme?: string;
  show_romanization?: number;
}

export interface UserRole {
  id: number;
  user_id: string;
  role_name: string;
  description?: string;
  permissions?: string;
  granted_by?: string;
  granted_at?: number;
  expires_at?: number;
}

export interface UserProgressData {
  episode_stats: Array<{
    id: number;
    user_id: string;
    film_id: string;
    episode_slug: string;
    total_cards: number;
    completed_cards: number;
    last_card_index: number;
    completion_percentage: number;
    last_completed_at: number;
    created_at: number;
    updated_at: number;
  }>;
  recent_cards: Array<{
    id: number;
    user_id: string;
    film_id: string;
    episode_id: string;
    card_id: string;
    completed_at: number;
    created_at: number;
  }>;
}

export async function apiGetAllUsers(): Promise<UserProfile[]> {
  return getJson<UserProfile[]>('/users');
}

export async function apiGetUser(userId: string): Promise<UserProfile | null> {
  try {
    return await getJson<UserProfile>(`/users/${userId}`);
  } catch (e) {
    if ((e as Error).message?.includes('404')) return null;
    throw e;
  }
}

export async function apiGetUserProgressData(userId: string): Promise<UserProgressData> {
  return getJson<UserProgressData>(`/users/${userId}/progress`);
}

export async function apiSyncAdminRoles(params: {
  adminEmails: string[];
  requesterId: string;
}): Promise<{
  success: boolean;
  synced: number;
  skipped: number;
  message: string;
}> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/admin/sync-roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Admin sync failed: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiGetDatabaseStats(): Promise<Record<string, number>> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/database-stats`;
  
  const res = await fetch(fullUrl, {
    headers: { 
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch database stats: ${res.status} ${text}`);
  }
  
  return await res.json();
}

/**
 * Get detailed database size analysis (SuperAdmin only)
 */
export async function apiGetDatabaseSizeAnalysis(): Promise<{
  database: {
    pageCount: number | null;
    pageSizeBytes: number | null;
    estimatedSizeMB: number;
    estimatedSizeGB: number;
    maxSizeGB: number;
    usagePercent: number;
  };
  tables: Array<{
    name: string;
    type: string;
    critical: boolean;
    rowCount: number;
    estimatedSizeMB: number;
    estimatedSizeGB: number;
  }>;
  analysis: {
    search_terms: {
      totalRows: number;
      uniqueRows: number;
      duplicates: number;
    };
    card_subtitles_fts: {
      rowCount: number;
    };
  };
  recommendations: Array<{
    priority: string;
    action: string;
    description: string;
    estimatedSavingsMB: number;
  }>;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/database-size-analysis`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch database size analysis: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Cleanup duplicate search_terms (SuperAdmin only)
 */
export async function apiCleanupSearchTerms(minFrequency?: number): Promise<{
  message: string;
  duplicatesRemoved: number;
  lowFrequencyRemoved: number;
  remainingRows: number;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/cleanup-search-terms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ minFrequency: minFrequency || 1 })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to cleanup search_terms: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Optimize search_terms by removing low-frequency terms (SuperAdmin only)
 */
export async function apiOptimizeSearchTerms(minFrequency: number): Promise<{
  message: string;
  removedRows: number;
  remainingRows: number;
  minFrequency: number;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/optimize-search-terms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ minFrequency })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to optimize search_terms: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Cleanup orphaned FTS5 records (SuperAdmin only)
 */
export async function apiCleanupFts5Orphaned(): Promise<{
  message: string;
  removedRows: number;
  remainingRows: number;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/cleanup-fts5-orphaned`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to cleanup FTS5 orphaned records: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Rebuild FTS5 index (SuperAdmin only)
 */
export async function apiRebuildFts5(batchSize?: number, offset?: number): Promise<{
  message: string;
  processed: number;
  totalProcessed: number;
  totalRows: number;
  hasMore: boolean;
  nextOffset: number | null;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/rebuild-fts5`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ batchSize: batchSize || 10000, offset: offset || 0 })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to rebuild FTS5: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Drop FTS5 table (SuperAdmin only) - Use if migration fails
 */
export async function apiDropFts5(): Promise<{
  message: string;
  success: boolean;
}> {
  assertApiBase();
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const res = await fetch(`${API_BASE}/api/admin/drop-fts5`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to drop FTS5 table: ${res.status} ${text}`);
  }

  return await res.json();
}

export async function apiGetTableData(tableName: string, limit: number = 100): Promise<Array<Record<string, unknown>>> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/table-data/${tableName}?limit=${limit}`;
  
  const res = await fetch(fullUrl, {
    headers: { 
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch table data: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiUpdateTableRecord(
  tableName: string, 
  recordId: string | number, 
  data: Record<string, unknown>
): Promise<{ success: boolean }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/table-data/${tableName}/${recordId}`;
  
  const res = await fetch(fullUrl, {
    method: 'PUT',
    headers: { 
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update record: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiDeleteTableRecord(
  tableName: string, 
  recordId: string | number
): Promise<{ success: boolean }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/table-data/${tableName}/${recordId}`;
  
  const res = await fetch(fullUrl, {
    method: 'DELETE',
    headers: { 
      'Accept': 'application/json',
    },
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete record: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiUpdateUserRoles(
  userId: string,
  roles: string[],
  requesterId: string
): Promise<{ success: boolean; message: string }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/user-roles/${userId}`;
  
  const res = await fetch(fullUrl, {
    method: 'PUT',
    headers: { 
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roles, requesterId }),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update user roles: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiGetUserRoles(userId: string): Promise<string[]> {
  assertApiBase();
  const fullUrl = `${API_BASE}/api/admin/user-roles/${userId}`;
  
  const res = await fetch(fullUrl, {
    headers: { 
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch user roles: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  return data.roles || [];
}

// ==================== Level Assessment APIs ====================

export interface ReferenceImportProgress {
  processed: number;
  total: number;
  errors: string[];
}

export async function apiImportReferenceData(
  _type: 'cefr' | 'reference' | 'frequency', // Parameter kept for backward compatibility but not used
  data: Record<string, number> | Array<Record<string, unknown>>,
  framework?: string
): Promise<{ success: boolean; errors?: string[]; processed?: number }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/admin/import-reference`;
  
  // For frequency type, data should be a JSON object { word: rank }
  // For backward compatibility, we still accept arrays but the API now expects objects for frequency
  const requestBody: { type: string; data: Record<string, number> | Array<Record<string, unknown>>; framework?: string } = {
    type: 'frequency', // Always use 'frequency' now (no more 'cefr' type)
    data: data as any,
    framework
  };
  
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to import reference data: ${res.status} ${text}`);
  }
  
  return await res.json();
}

export async function apiAssessContentLevel(
  contentSlug: string,
  _onProgress?: (progress: { cardsProcessed: number; totalCards: number }) => void
): Promise<{ success: boolean }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/admin/assess-content-level`;
  
  // Use fetch with streaming or polling for progress
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ contentSlug }),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to assess content level: ${res.status} ${text}`);
  }
  
  // For now, return immediately. Progress tracking would need server-sent events or polling
  return await res.json();
}

export async function apiGetSystemConfig(key: string): Promise<string | null> {
  assertApiBase();
  const fullUrl = `${API_BASE}/admin/system-config/${key}`;
  
  const res = await fetch(fullUrl, {
    headers: { 
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  
  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get system config: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  return data.value || null;
}

export async function apiUpdateSystemConfig(key: string, value: string): Promise<{ success: boolean }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/admin/system-config/${key}`;
  
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update system config: ${res.status} ${text}`);
  }
  
  return await res.json();
}

// Check if reference data exists for a framework
export async function apiCheckReferenceData(framework: string): Promise<{ exists: boolean; hasReferenceList: boolean; hasFrequencyData: boolean }> {
  assertApiBase();
  const fullUrl = `${API_BASE}/admin/check-reference-data?framework=${encodeURIComponent(framework)}`;
  
  const res = await fetch(fullUrl, {
    headers: { 
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  
  if (!res.ok) {
    if (res.status === 404) return { exists: false, hasReferenceList: false, hasFrequencyData: false };
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to check reference data: ${res.status} ${text}`);
  }
  
  return await res.json();
}

// ==================== REWARDS CONFIG (SuperAdmin only) ====================

export interface RewardConfig {
  id: number;
  action_type: string;
  reward_type: string;
  xp_amount: number;
  coin_amount: number;
  is_repeatable: number;
  cooldown_seconds: number | null;
  description: string | null;
  interval_seconds: number | null;
  created_at: number;
  updated_at?: number | null;
}

/**
 * Get all rewards config (SuperAdmin only)
 */
export async function apiGetRewardsConfig(): Promise<RewardConfig[]> {
  assertApiBase();
  
  const token = localStorage.getItem('jwt_token');
  const headers: HeadersInit = {
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(`${API_BASE}/api/admin/rewards-config`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get rewards config: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.configs || [];
}

/**
 * Update a rewards config (SuperAdmin only)
 */
export async function apiUpdateRewardsConfig(
  id: number,
  updates: {
    xp_amount?: number;
    coin_amount?: number;
    interval_seconds?: number | null;
    description?: string | null;
  }
): Promise<RewardConfig> {
  assertApiBase();
  
  const token = localStorage.getItem('jwt_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(`${API_BASE}/api/admin/rewards-config`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ id, ...updates }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update rewards config: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.config;
}
