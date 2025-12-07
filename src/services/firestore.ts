// Cloudflare D1 adapter - replaces Firebase Firestore
import { apiGetFilm, apiListFilms, apiFetchCardsForFilm, apiFetchAllCards, apiGetCardByPath, apiListItems, apiSearchCardsFTS } from "./cfApi";
import { canonicalizeLangCode } from "../utils/lang";
import { subtitleText } from "../utils/subtitles";
import type { CardDoc, FilmDoc } from "../types";

export async function getFilmDoc(filmId: string): Promise<FilmDoc | null> {
  return await apiGetFilm(filmId);
}

// Unique list of main languages present across content items
export async function getAvailableMainLanguages(): Promise<string[]> {
  try {
    const items = await apiListItems();
    const set = new Set<string>();
    items.forEach((it) => {
      const ml = (it as any).main_language || (it as any).language; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (ml) set.add(canonicalizeLangCode(ml) || String(ml).toLowerCase());
    });
    const out = Array.from(set);
    out.sort((a, b) => {
      if (a === "en" && b !== "en") return -1;
      if (b === "en" && a !== "en") return 1;
      return a.localeCompare(b);
    });
    return out.length ? out : ["en"];
  } catch {
    return ["en"];
  }
}

export async function getAvailableLanguagesForFilm(filmId: string): Promise<string[]> {
  // Global mode: derive from actual cards' subtitle keys to avoid relying on optional item metadata
  if (filmId === "global") {
    try {
      const cards = await apiFetchAllCards(5000);
      const set = new Set<string>();
      cards.forEach((c) => {
        const sub = c.subtitle || {};
        Object.keys(sub).forEach((k) => set.add(canonicalizeLangCode(k) || k.toLowerCase()));
      });
      // Fallback: if still empty (e.g., no cards yet), attempt item metadata as a secondary source
      if (set.size === 0) {
        try {
          const items = await apiListItems();
          items.forEach((it) => {
            (it.available_subs || []).forEach((l) => set.add(canonicalizeLangCode(l) || l.toLowerCase()));
          });
        } catch {/* ignore */}
      }
      const out = Array.from(set);
      out.sort((a, b) => {
        if (a === "en" && b !== "en") return -1;
        if (b === "en" && a !== "en") return 1;
        return a.localeCompare(b);
      });
      return out.length ? out : ["en"]; // safe fallback to English if nothing found
    } catch {
      return ["en"]; // safe fallback
    }
  }
  // Film-specific mode: prefer film.available_subs, augment with first card's keys as fallback
  const film = await getFilmDoc(filmId);
  const base = (film?.available_subs ?? []).map((c) => canonicalizeLangCode(c) || c.toLowerCase());
  const set = new Set<string>(base);
  try {
    const cards = await apiFetchCardsForFilm(filmId, "e1", 1);
    if (cards.length > 0) {
      const sub = cards[0].subtitle;
      if (sub) {
        Object.keys(sub).forEach((k) => set.add(canonicalizeLangCode(k) || k.toLowerCase()));
      }
    }
  } catch {/* ignore */}
  const out = Array.from(set);
  out.sort((a, b) => {
    if (a === "en" && b !== "en") return -1;
    if (b === "en" && a !== "en") return 1;
    return a.localeCompare(b);
  });
  return out;
}

export async function listFilms(): Promise<FilmDoc[]> {
  return await apiListFilms();
}

// List all items regardless of type (movie, series, book, audio)
export async function listAllItems(): Promise<FilmDoc[]> {
  return await apiListItems();
}
// Filter items by content type (film/series/book/audio)
export async function listContentByType(type: string): Promise<FilmDoc[]> {
  const all = await apiListItems();
  return all.filter(f => (f.type || 'film') === type);
}

export async function getEpisodeIdsForFilm(filmId: string): Promise<string[]> {
  const film = await getFilmDoc(filmId);
  const total = film?.episodes ?? 1;
  return Array.from({ length: Number(total) || 1 }, (_, i) => `e${i + 1}`);
}

export async function fetchCardsForFilm(
  filmId: string,
  episodeId: string,
  max: number = 50,
  opts?: { startFrom?: number }
): Promise<CardDoc[]> {
  return await apiFetchCardsForFilm(filmId, episodeId, max, opts);
}

export async function searchCardsClient(
  filmId: string,
  queryText: string,
  primaryLang?: string,
  episodeId?: string
): Promise<CardDoc[]> {
  const pool = await fetchCardsForFilm(filmId, episodeId ?? "e1", 200);
  const q = queryText.trim().toLowerCase();
  if (!q) return pool;
  const lang = canonicalizeLangCode(primaryLang ?? "") || (primaryLang?.toLowerCase() || "");
  return pool.filter((c) => {
    const text = lang ? (subtitleText(c, lang) ?? "") : "";
    if (text) return text.toLowerCase().includes(q);
    return Object.values(c.subtitle ?? {}).some((t) => (t ?? "").toLowerCase().includes(q));
  });
}

export async function fetchAllCards(max = 1000): Promise<CardDoc[]> {
  return await apiFetchAllCards(max);
}

// Lightweight in-memory cache to avoid re-fetching the global cards pool on every keystroke
// Cache is shared within the module and expires after a short TTL
let __allCardsCache: { data: CardDoc[]; max: number; expiresAt: number } | null = null;
let __allCardsInflight: Promise<CardDoc[]> | null = null;

// Allow external callers to invalidate cached global cards pool
export function invalidateGlobalCardsCache() {
  __allCardsCache = null;
  __allCardsInflight = null;
}

async function fetchAllCardsCached(max = 1000, ttlMs = 120_000): Promise<CardDoc[]> {
  const now = Date.now();
  if (
    __allCardsCache &&
    __allCardsCache.expiresAt > now &&
    __allCardsCache.max >= max
  ) {
    return __allCardsCache.data;
  }
  if (__allCardsInflight) {
    try {
      const data = await __allCardsInflight;
      // Even if in-flight was for a different max, reuse if it's good enough
      if (data && (__allCardsCache?.max ?? 0) >= max && (__allCardsCache?.expiresAt ?? 0) > Date.now()) {
        return data;
      }
    } catch {
      // ignore and fall through to new fetch
    }
  }
  // Fetch with the requested max; store and set TTL
  __allCardsInflight = apiFetchAllCards(max)
    .then((rows) => {
      __allCardsCache = {
        data: rows,
        max,
        expiresAt: Date.now() + ttlMs,
      };
      return rows;
    })
    .finally(() => {
      // leave last promise around until next call completes; don't null immediately to allow short coalescing window
    });
  return await __allCardsInflight;
}

export async function searchCardsGlobalClient(
  queryText: string,
  max = 200,
  filmFilter?: string | null,
  filmLanguageMap?: Record<string, string>,
  selectedMainLang?: string
): Promise<CardDoc[]> {
  const q = queryText.trim();
  // Prefer server-side FTS when there is a query; fall back to cached client filtering on error
  if (q) {
    try {
      const main = selectedMainLang ? (canonicalizeLangCode(selectedMainLang) || selectedMainLang.toLowerCase()) : null;
      const rows = await apiSearchCardsFTS({ q, limit: max, mainLanguage: main });
      const filteredServer = filmFilter ? rows.filter(r => r.film_id === filmFilter) : rows;
      // If server FTS returns results, use them directly.
      if (filteredServer.length > 0) return filteredServer;
      // Fallback condition: zero results for short or single-token query -> attempt client substring match (prefix behavior)
      const tokenCount = q.split(/\s+/).filter(Boolean).length;
      const isShort = q.length < 4 || tokenCount === 1;
      if (!isShort) {
        // For multi-token longer queries, keep empty result (more precise intent)
        return filteredServer; // empty
      }
      // Proceed to client-side fallback below
    } catch {
      // fall through to client filtering
    }
  }
  // Use cached global pool to minimize repeated network calls while typing or when no query
  const pool = await fetchAllCardsCached(max);
  const qLower = q.toLowerCase();
  const pool1 = filmFilter ? pool.filter((c) => c.film_id === filmFilter) : pool;
  const hasLangMap = !!filmLanguageMap && Object.keys(filmLanguageMap).length > 0;
  const pool2 = selectedMainLang && hasLangMap
    ? pool1.filter((c) => {
        const fid = String(c.film_id ?? "");
        const main = filmLanguageMap?.[fid];
        return !!main && (canonicalizeLangCode(main) || main.toLowerCase()) === (canonicalizeLangCode(selectedMainLang) || selectedMainLang.toLowerCase());
      })
    : pool1;
  if (!q) return pool2;
  return pool2.filter((c) => {
    const lang = filmLanguageMap?.[String(c.film_id ?? "")] ?? "";
    const canonical = canonicalizeLangCode(lang) || lang.toLowerCase();
    // Prefer main-language subtitle; fallback to sentence when absent.
    const primaryText = canonical ? (subtitleText(c, canonical) || c.sentence || "") : (c.sentence || "");
    if (primaryText) return primaryText.toLowerCase().includes(qLower);
    // If a main language filter is active, do NOT fall back to other subtitle languages beyond sentence.
    if (selectedMainLang) return false;
    return Object.values(c.subtitle ?? {}).some((t) => (t ?? "").toLowerCase().includes(qLower));
  });
}

export async function getCardByPath(filmId: string, episodeId: string, cardId: string): Promise<CardDoc | null> {
  return await apiGetCardByPath(filmId, episodeId, cardId);
}
