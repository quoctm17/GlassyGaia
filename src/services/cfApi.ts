// Cloudflare API client and helpers for D1 + R2
import type { CardDoc, FilmDoc } from "../types";

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`; // default to https if scheme missing
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(import.meta.env.VITE_CF_API_BASE as string | undefined);
const R2_PUBLIC_BASE = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";

function assertApiBase() {
  if (!API_BASE) {
    throw new Error("VITE_CF_API_BASE is not set. Provide your Cloudflare Worker/Pages API base URL.");
  }
}

async function getJson<T>(path: string): Promise<T> {
  assertApiBase();
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    // Treat 404 as empty data so UI can show empty-state gracefully
    if (res.status === 404) {
      // Attempt to return sensible empty shape: [] or null
      // Caller should narrow type; we use 'any' cast here.
      return ([] as unknown) as T;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// Build media URLs when the API doesn't provide them explicitly.
export function buildR2MediaUrl(params: {
  filmId: string;
  episodeId: string; // e.g., e1
  cardId: string; // padded id like 001
  type: "audio" | "image";
  // Optional overrides
  filePrefix?: string; // filename prefix if different from folder name; fallback: normalized filmId
}): string {
  // Updated naming convention (2025-11): nested path using filmSlug_episodeNum as episode folder.
  // Pattern (public URL path):
  //   items/{filmId}/episodes/{filmId}_{episodeNum}/{type}/{filmId_normalized}_{cardId}.{ext}
  const { filmId, episodeId, cardId, type } = params;
  // Support episodeId in formats: e1, 1, filmSlug_1
  let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
  if (!epNum || Number.isNaN(epNum)) {
    const m = String(episodeId || "").match(/_(\d+)$/);
    epNum = m ? Number(m[1]) : 1;
  }
  const prefix = (params.filePrefix || filmId).replace(/-/g, "_");
  const ext = type === "image" ? "jpg" : "mp3";
  if (!R2_PUBLIC_BASE) {
    return `/items/${filmId}/episodes/${filmId}_${epNum}/${type}/${prefix}_${cardId}.${ext}`;
  }
  return `${R2_PUBLIC_BASE}/items/${filmId}/episodes/${filmId}_${epNum}/${type}/${prefix}_${cardId}.${ext}`;
}

// Deprecated helper retained for backward compat (not used with new schema)
// remove unused legacy helper entirely


// New normalized endpoint: /items returns generic content items (films/music/books).
// We filter to type === 'film' for admin Films views.
export async function apiListFilms(): Promise<FilmDoc[]> {
  const items = await getJson<Array<Partial<FilmDoc> & { id: string; type?: string }>>(`/items`);
  return items
    .filter((f) => !f.type || f.type === 'movie')
    .map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      cover_url: f.cover_url,
      main_language: (f as unknown as { main_language?: string; language?: string }).main_language
        || (f as unknown as { main_language?: string; language?: string }).language,
      type: f.type,
      release_year: f.release_year,
      episodes: f.episodes,
  total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number }).total_episodes,
      available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
    }));
}

// List all content items (any type) without client-side filtering
export async function apiListItems(): Promise<FilmDoc[]> {
  const items = await getJson<Array<Partial<FilmDoc> & { id: string; type?: string }>>(`/items`);
  return items.map((f) => ({
    id: f.id!,
    title: f.title,
    description: f.description,
    cover_url: f.cover_url,
    main_language: (f as unknown as { main_language?: string; language?: string }).main_language
      || (f as unknown as { main_language?: string; language?: string }).language,
    type: f.type,
    release_year: f.release_year,
    episodes: f.episodes,
    total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number }).total_episodes,
    available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
  }));
}

export async function apiGetFilm(filmId: string): Promise<FilmDoc | null> {
  try {
    const f = await getJson<Partial<FilmDoc> & { id?: string }>(`/items/${encodeURIComponent(filmId)}`);
    if (!f || typeof f !== 'object' || Array.isArray(f) || !('id' in f) || !f.id) {
      throw new Error('Not Found');
    }
    const lm = f as unknown as { main_language?: string; language?: string };
    const film: FilmDoc = {
      id: f.id!,
      title: f.title,
      description: f.description,
      cover_url: f.cover_url,
      main_language: lm.main_language || lm.language,
      type: f.type,
      release_year: f.release_year,
      episodes: f.episodes,
  total_episodes: (f as Partial<FilmDoc> & { total_episodes?: number }).total_episodes,
      available_subs: Array.isArray(f.available_subs) ? f.available_subs : [],
    };
    return film;
  } catch {
    return null;
  }
}

export async function apiFetchCardsForFilm(
  filmId: string,
  episodeId?: string,
  max: number = 50
): Promise<CardDoc[]> {
  // New backend path may differ; attempt first new normalized then fallback.
  const basePath = episodeId
    ? `/items/${encodeURIComponent(filmId)}/episodes/${encodeURIComponent(episodeId)}/cards?limit=${max}`
    : `/items/${encodeURIComponent(filmId)}/cards?limit=${max}`;
  const rows = await getJson<Array<any>>(basePath); // eslint-disable-line @typescript-eslint/no-explicit-any
  return rows.map(rowToCardDoc);
}

export async function apiFetchAllCards(max = 1000): Promise<CardDoc[]> {
  const rows = await getJson<Array<any>>(`/cards?limit=${max}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  return rows.map(rowToCardDoc);
}

export async function apiGetCardByPath(filmId: string, episodeId: string, cardId: string): Promise<CardDoc | null> {
  try {
    const row = await getJson<any>(`/cards/${encodeURIComponent(filmId)}/${encodeURIComponent(episodeId)}/${encodeURIComponent(cardId)}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    return rowToCardDoc(row);
  } catch {
    return null;
  }
}

// Signed upload to R2: ask the Worker for a signed URL, then PUT the bytes.
export async function r2UploadViaSignedUrl(params: { bucketPath: string; file: File; contentType?: string }) {
  assertApiBase();
  const { bucketPath, file } = params;
  const ct = params.contentType || file.type || "application/octet-stream";
  const signRes = await fetch(`${API_BASE}/r2/sign-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: bucketPath, contentType: ct }),
  });
  if (!signRes.ok) {
    throw new Error(`Failed to get signed URL: ${signRes.status}`);
  }
  const { url } = (await signRes.json()) as { url: string };
  const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": ct } });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
}

// Import CSV-processed payload into D1 via Worker
export interface ImportPayload {
  // allow extra film fields (e.g., episode_title) to flow through
  film: (FilmDoc & { slug?: string }) & Record<string, unknown>; // slug used externally, id may be UUID internally
  episodeNumber: number; // numeric episode
  cards: Array<Partial<CardDoc> & { id?: string; card_number?: number }>;
  mode?: 'replace' | 'append';
}

export async function apiImport(payload: ImportPayload) {
  assertApiBase();
  const res = await fetch(`${API_BASE}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status}`);
  return await res.json().catch(() => ({}));
}

// Update film meta (title, description, cover)
export async function apiUpdateFilmMeta(params: { filmSlug: string; title?: string | null; description?: string | null; cover_url?: string | null; total_episodes?: number | null; full_audio_url?: string | null; full_video_url?: string | null; type?: string | null; release_year?: number | null }) {
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
export async function apiUpdateEpisodeMeta(params: { filmSlug: string; episodeNum: number; title?: string; full_audio_url?: string; full_video_url?: string }) {
  assertApiBase();
  const { filmSlug, episodeNum, ...body } = params;
  const epSlug = `${filmSlug}_${episodeNum}`;
  const res = await fetch(`${API_BASE}/items/${encodeURIComponent(filmSlug)}/episodes/${encodeURIComponent(epSlug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Update episode meta failed: ${res.status} ${text}`);
  }
}

// Helper to convert a normalized API row into CardDoc
function rowToCardDoc(r: any): CardDoc { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Expect fields: card_id or id, episode_id, film_id?, start_time_ms, end_time_ms, audio_key, image_key, subtitles? or subtitle map.
  const id = String(r.id ?? r.card_id ?? "");
  const episodeId = String(r.episode_id ?? r.episode ?? "e1");
  const filmId = r.film_id ? String(r.film_id) : undefined;
  const startMs = Number(r.start_time_ms ?? r.start_ms ?? r.start ?? 0);
  const endMs = Number(r.end_time_ms ?? r.end_ms ?? r.end ?? 0);
  const start = startMs > 1000 ? startMs / 1000 : startMs; // convert if ms
  const end = endMs > 1000 ? endMs / 1000 : endMs;
  const sub = r.subtitle || r.subtitles || {};
  const subtitle: Record<string, string> = Array.isArray(sub)
    ? sub.reduce((acc: Record<string, string>, row: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (row && row.language && row.text) acc[String(row.language)] = String(row.text);
        return acc;
      }, {})
    : (sub as Record<string, string>);
  // Build media URLs: if audio_key/image_key are full URLs use them; otherwise treat as bucket paths relative to R2_PUBLIC_BASE
  const audioUrl = buildMediaUrlFromKey(r.audio_url || r.audio_key, filmId, episodeId, id, "audio");
  const imageUrl = buildMediaUrlFromKey(r.image_url || r.image_key, filmId, episodeId, id, "image");
  return {
    id,
    episode: episodeId,
    episode_id: episodeId,
    start,
    end,
    audio_url: audioUrl,
    image_url: imageUrl,
    subtitle,
    film_id: filmId,
    sentence: r.sentence,
    CEFR_Level: r.CEFR_Level || r.cefr || r.cefr_level,
    words: r.words || undefined,
    difficulty_score: typeof r.difficulty_score === 'number' ? r.difficulty_score : undefined,
  };
}

function buildMediaUrlFromKey(key: string | undefined, filmId: string | undefined, episodeId: string, cardId: string, type: "audio" | "image"): string {
  if (!key) {
    return buildR2MediaUrl({ filmId: filmId || "", episodeId, cardId, type });
  }
  if (/^https?:\/\//i.test(key)) return key;
  if (key.includes("/")) {
    // If existing objects still under films/, return them directly; new ones under items/
    return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : `/${key}`;
  }
  // simple filename (no path): assume it already follows new naming prefix_cardId.ext
  const prefix = (filmId || "").replace(/-/g, "_");
  const ext = type === "image" ? "jpg" : "mp3";
  let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
  if (!epNum || Number.isNaN(epNum)) {
    const m = String(episodeId || "").match(/_(\d+)$/);
    epNum = m ? Number(m[1]) : 1;
  }
  const fileName = `${prefix}_${cardId}.${ext}`;
  return R2_PUBLIC_BASE
    ? `${R2_PUBLIC_BASE}/items/${filmId}/episodes/${filmId}_${epNum}/${type}/${fileName}`
    : `/items/${filmId}/episodes/${filmId}_${epNum}/${type}/${fileName}`;
}
