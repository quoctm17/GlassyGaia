// Cloudflare Worker example implementing routes expected by frontend.
// Bindings required in wrangler.toml or Dashboard:
// - DB (D1 Database)
// - MEDIA_BUCKET (R2 Bucket)
// This is a minimal scaffold: empty lists when DB has no data; add real SQL later.
// IMPORTANT: Replace account specific endpoint logic if you change upload strategy.

// Minimal ambient type declarations for local type-checking without Cloudflare types package.
// In a real project: `npm i -D @cloudflare/workers-types` then remove these.
interface D1ExecResult<T = unknown> { results?: T[] }
interface D1PreparedStatement<T = unknown> {
  bind(...values: unknown[]): D1PreparedStatement<T>;
  first<R = unknown>(): Promise<R | null>;
  all<R = unknown>(): Promise<D1ExecResult<R>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare<T = unknown>(query: string): D1PreparedStatement<T>;
}
interface R2PutOptions { httpMetadata?: { contentType?: string } }
interface R2Bucket { put(key: string, value: ReadableStream | null | ArrayBuffer | string | Blob, opts?: R2PutOptions): Promise<unknown> }

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
}

interface FilmRow { id: string; title?: string; description?: string; main_language?: string; type?: string; release_year?: number; }
interface CardSubtitleRow { card_id: string; language: string; text: string; }
interface CardRow { id: string; episode_id: string; start_time_ms: number; end_time_ms: number; image_key?: string; audio_key?: string; }

function withCors(headers: HeadersInit = {}): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers,
  };
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: withCors({ 'Content-Type': 'application/json', ...(init.headers || {}) }) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    try {
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: withCors() });
      }
      // Signed upload endpoint (front-end expects POST with path, contentType)
      if (path === '/r2/sign-upload' && request.method === 'POST') {
        const body = await request.json();
        const key: string = body.path;
        const contentType: string = body.contentType || 'application/octet-stream';
        if (!key) return json({ error: 'Missing path' }, { status: 400 });
        // For simplicity, we will NOT generate a presigned URL; instead we return a pseudo URL
        // pointing to a Worker PUT proxy: /r2/upload?key=... so frontend can PUT there.
        // Change frontend to detect url starting with 'worker://' or just treat as normal URL.
        const uploadUrl = url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType);
        return json({ url: uploadUrl });
      }
      if (path === '/r2/upload' && request.method === 'PUT') {
        const key = url.searchParams.get('key');
        const ct = url.searchParams.get('ct') || 'application/octet-stream';
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        await env.MEDIA_BUCKET.put(key, request.body, { httpMetadata: { contentType: ct } });
        return json({ ok: true, key });
      }

      // Films list
      if (path === '/films' && request.method === 'GET') {
        // Attempt select from DB; if tables empty or not created return []
        try {
          const res = await env.DB.prepare('SELECT id,title,main_language,type,release_year,description FROM films').all<FilmRow>();
          const films = (res.results || []).map((r: FilmRow) => ({ ...r }));
          return json(films);
        } catch { return json([]); }
      }

      // Film detail
      const filmMatch = path.match(/^\/films\/([^/]+)$/);
      if (filmMatch && request.method === 'GET') {
        const filmId = filmMatch[1];
        try {
          const filmRes = await env.DB.prepare('SELECT id,title,main_language,type,release_year,description FROM films WHERE id=?').bind(filmId).first<FilmRow>();
          if (!filmRes) return new Response('Not found', { status: 404 });
          // languages
          const langRes = await env.DB.prepare('SELECT language FROM film_available_languages WHERE film_id=?').bind(filmId).all<{ language: string }>();
          return json({ ...filmRes, available_subs: (langRes.results || []).map((r: { language: string }) => r.language) });
        } catch { return new Response('Not found', { status: 404 }); }
      }

      // Cards list for film/episode
      const filmCardsMatch = path.match(/^\/films\/([^/]+)\/episodes\/([^/]+)\/cards$/);
      if (filmCardsMatch && request.method === 'GET') {
        const filmId = filmCardsMatch[1];
        const episodeId = filmCardsMatch[2];
        const limit = Number(url.searchParams.get('limit') || '50');
        try {
          const sql = `SELECT c.id,c.episode_id,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key FROM cards c JOIN episodes e ON c.episode_id=e.id WHERE e.film_id=? AND c.episode_id=? ORDER BY c.start_time_ms ASC LIMIT ?`;
          const res = await env.DB.prepare(sql).bind(filmId, episodeId, limit).all<CardRow>();
          const rows = res.results || [];
          // fetch subtitles
          const out: Array<CardRow & { subtitle: Record<string,string> }> = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.id).all<CardSubtitleRow>();
            const subtitle: Record<string,string> = {};
            (subs.results||[]).forEach((s: CardSubtitleRow) => { subtitle[s.language] = s.text; });
            out.push({ ...r, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // Global cards list
      if (path === '/cards' && request.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || '100');
        try {
          const sql = `SELECT c.id,c.episode_id,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,e.film_id FROM cards c JOIN episodes e ON c.episode_id=e.id ORDER BY c.start_time_ms ASC LIMIT ?`;
          const res = await env.DB.prepare(sql).bind(limit).all<CardRow & { film_id: string }>();
          const rows = res.results || [];
          const out: Array<(CardRow & { film_id: string }) & { subtitle: Record<string,string> }> = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.id).all<CardSubtitleRow>();
            const subtitle: Record<string,string> = {};
            (subs.results||[]).forEach((s: CardSubtitleRow) => { subtitle[s.language] = s.text; });
            out.push({ ...r, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // Card by path
      const cardMatch = path.match(/^\/cards\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (cardMatch && request.method === 'GET') {
        const filmId = cardMatch[1];
        const episodeId = cardMatch[2];
        const cardId = cardMatch[3];
        try {
          const sql = `SELECT c.id,c.episode_id,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,e.film_id FROM cards c JOIN episodes e ON c.episode_id=e.id WHERE e.film_id=? AND c.episode_id=? AND c.id=? LIMIT 1`;
          const row = await env.DB.prepare(sql).bind(filmId, episodeId, cardId).first<CardRow & { film_id: string }>();
          if (!row) return new Response('Not found', { status: 404 });
          const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(row.id).all<CardSubtitleRow>();
          const subtitle: Record<string,string> = {};
            (subs.results||[]).forEach((s: CardSubtitleRow) => { subtitle[s.language] = s.text; });
          return json({ ...row, subtitle });
        } catch { return new Response('Not found', { status: 404 }); }
      }

      // Import bulk payload (film + cards) from CSV processor
      if (path === '/import' && request.method === 'POST') {
        const body = await request.json();
        const film = body.film; // {id,title,language,available_subs,...}
        const episodeId: string = body.episodeId;
  const cards: Array<{ id: string; start?: number; end?: number; subtitle?: Record<string,string>; image_url?: string; audio_url?: string; }> = body.cards || [];
        if (!film?.id || !episodeId) return json({ error: 'Missing film.id or episodeId' }, { status: 400 });
        // Upsert film
        try {
          await env.DB.prepare('INSERT OR IGNORE INTO films (id,title,main_language,type,description,release_year) VALUES (?,?,?,?,?,?)').bind(film.id, film.title||film.id, film.language || film.main_language || 'en', film.type || 'film', film.description || '', film.release_year || null).run();
          // available languages
          if (Array.isArray(film.available_subs)) {
            for (const lang of film.available_subs) {
              await env.DB.prepare('INSERT OR IGNORE INTO film_available_languages (film_id,language) VALUES (?,?)').bind(film.id, lang).run();
            }
          }
          // Ensure episode row
            await env.DB.prepare('INSERT OR IGNORE INTO episodes (id,film_id,episode_number,title) VALUES (?,?,?,?)').bind(episodeId, film.id, Number(episodeId.replace(/^e/i,'')||'1'), episodeId).run();
          // Insert cards + subtitles
          for (const c of cards) {
            await env.DB.prepare('INSERT OR IGNORE INTO cards (id,episode_id,start_time_ms,end_time_ms,image_key,audio_key) VALUES (?,?,?,?,?,?)').bind(c.id, episodeId, Math.round((c.start||0)*1000), Math.round((c.end||0)*1000), c.image_url ? c.image_url.replace(/^https?:\/\/[^/]+\//,'') : null, c.audio_url ? c.audio_url.replace(/^https?:\/\/[^/]+\//,'') : null).run();
            if (c.subtitle) {
              for (const [lang,text] of Object.entries(c.subtitle)) {
                if (!text) continue;
                await env.DB.prepare('INSERT OR IGNORE INTO card_subtitles (card_id,language,text) VALUES (?,?,?)').bind(c.id, lang, text).run();
              }
            }
          }
          return json({ ok: true, inserted: cards.length });
        } catch (e) {
          return json({ error: (e as Error).message }, { status: 500 });
        }
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: (e as Error).message }, { status: 500 });
    }
  }
};
