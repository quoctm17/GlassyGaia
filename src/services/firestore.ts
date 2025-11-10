// Cloudflare D1 adapter - replaces Firebase Firestore
import { apiGetFilm, apiListFilms, apiFetchCardsForFilm, apiFetchAllCards, apiGetCardByPath } from "./cfApi";
import { canonicalizeLangCode } from "../utils/lang";
import { subtitleText } from "../utils/subtitles";
import type { CardDoc, FilmDoc } from "../types";

export async function getFilmDoc(filmId: string): Promise<FilmDoc | null> {
  return await apiGetFilm(filmId);
}

export async function getAvailableLanguagesForFilm(filmId: string): Promise<string[]> {
  const film = await getFilmDoc(filmId);
  const base = (film?.available_subs ?? []).map((c) => canonicalizeLangCode(c) || c.toLowerCase());
  const set = new Set<string>(base);
  // Try to detect from the first card in e1
  try {
    const cards = await apiFetchCardsForFilm(filmId, "e1", 1);
    if (cards.length > 0) {
      const sub = cards[0].subtitle;
      if (sub) {
        Object.keys(sub).forEach((k) => {
          const c = canonicalizeLangCode(k) || k.toLowerCase();
          set.add(c);
        });
      }
    }
  } catch {
    // ignore
  }
  const out = Array.from(set);
  // Sort: en first, then others alphabetically
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

export async function getEpisodeIdsForFilm(filmId: string): Promise<string[]> {
  const film = await getFilmDoc(filmId);
  const total = film?.episodes ?? 1;
  return Array.from({ length: Number(total) || 1 }, (_, i) => `e${i + 1}`);
}

export async function fetchCardsForFilm(
  filmId: string,
  episodeId?: string,
  max: number = 50
): Promise<CardDoc[]> {
  return await apiFetchCardsForFilm(filmId, episodeId, max);
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

export async function searchCardsGlobalClient(
  queryText: string,
  max = 200,
  filmFilter?: string | null,
  filmLanguageMap?: Record<string, string>
): Promise<CardDoc[]> {
  const pool = await fetchAllCards(max);
  const q = queryText.trim().toLowerCase();
  const pool2 = filmFilter ? pool.filter((c) => c.film_id === filmFilter) : pool;
  if (!q) return pool2;
  return pool2.filter((c) => {
    const lang = filmLanguageMap?.[String(c.film_id ?? "")] ?? "";
    const canonical = canonicalizeLangCode(lang) || lang.toLowerCase();
    const text = canonical ? (subtitleText(c, canonical) ?? "") : "";
    if (text) return text.toLowerCase().includes(q);
    return Object.values(c.subtitle ?? {}).some((t) => (t ?? "").toLowerCase().includes(q));
  });
}

export async function getCardByPath(filmId: string, episodeId: string, cardId: string): Promise<CardDoc | null> {
  return await apiGetCardByPath(filmId, episodeId, cardId);
}
