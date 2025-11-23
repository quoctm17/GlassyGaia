// Cloudflare API client and helpers for D1 + R2
import type { CardDoc, FilmDoc, EpisodeDetailDoc, LevelFrameworkStats } from "../types";

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
}): string {
  // New naming convention:
  // items/{filmId}/episodes/{filmId}_{episode3}/{type}/{filmId}_{episode3}_{card4}.{ext}
  const { filmId, episodeId, cardId, type } = params;
  let epNum = Number(String(episodeId || "e1").replace(/^e/i, ""));
  if (!epNum || Number.isNaN(epNum)) {
    const m = String(episodeId || "").match(/_(\d+)$/);
    epNum = m ? Number(m[1]) : 1;
  }
  const epPadded = String(epNum).padStart(3, "0");
  const isDigits = /^[0-9]+$/.test(String(cardId));
  const cardPadded = isDigits ? String(cardId).padStart(4, "0") : String(cardId);
  const ext = type === "image" ? "jpg" : "mp3";
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
export async function apiListItems(): Promise<FilmDoc[]> {
  const items = await getJson<
    Array<Partial<FilmDoc> & { id: string; type?: string }>
  >(`/items`);
  return items.map((f) => ({
    id: f.id!,
    title: f.title,
    description: f.description,
    cover_url: f.cover_url,
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
  }));
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
  cover_url: string | null;
  full_audio_url: string | null;
  full_video_url: string | null;
}

export async function apiListEpisodes(
  filmSlug: string
): Promise<EpisodeMetaApi[]> {
  try {
    const rows = await getJson<EpisodeMetaApi[]>(
      `/items/${encodeURIComponent(filmSlug)}/episodes`
    );
    return rows as EpisodeMetaApi[];
  } catch {
    return [];
  }
}

export async function apiFetchCardsForFilm(
  filmId: string,
  episodeId?: string,
  max: number = 50
): Promise<CardDoc[]> {
  // Always encode parts to support non-ASCII slugs (e.g., Vietnamese)
  const filmEnc = encodeURIComponent(filmId);
  const basePath = episodeId
    ? `/items/${filmEnc}/episodes/${encodeURIComponent(episodeId)}/cards?limit=${max}`
    : `/items/${filmEnc}/cards?limit=${max}`;
  const rows = await getJson<Array<Record<string, unknown>>>(basePath);
  return rows.map(rowToCardDoc);
}

export async function apiFetchAllCards(limit = 1000): Promise<CardDoc[]> {
  const rows = await getJson<Array<Record<string, unknown>>>(
    `/cards?limit=${limit}`
  );
  return rows.map(rowToCardDoc);
}

// Full-text search via Worker /search (FTS5)
export async function apiSearchCardsFTS(params: {
  q: string;
  limit?: number;
  mainLanguage?: string | null;
}): Promise<CardDoc[]> {
  const { q } = params;
  const limit = params.limit ?? 100;
  const main = params.mainLanguage ? `&main=${encodeURIComponent(params.mainLanguage)}` : "";
  const rows = await getJson<Array<Record<string, unknown>>>(
    `/search?q=${encodeURIComponent(q)}&limit=${limit}${main}`
  );
  return rows.map(rowToCardDoc);
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
      let attempts = 0; let lastErr: any = null;
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
    try { await r2MultipartAbort({ key, uploadId }); } catch {}
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

// Update film meta (title, description, cover)
export async function apiUpdateFilmMeta(params: {
  filmSlug: string;
  title?: string | null;
  description?: string | null;
  cover_url?: string | null;
  total_episodes?: number | null;
  type?: string | null;
  release_year?: number | null;
  is_original?: boolean | null;
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
  cover_url?: string;
  cover_key?: string;
  full_audio_url?: string;
  full_audio_key?: string;
  full_video_url?: string;
  full_video_key?: string;
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
  const start = startMs > 1000 ? startMs / 1000 : startMs; // convert if ms
  const end = endMs > 1000 ? endMs / 1000 : endMs;
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
