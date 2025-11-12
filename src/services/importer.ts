// Cloudflare D1 importer - sends parsed CSV to Worker API
import Papa from "papaparse";
import { apiImport, buildR2MediaUrl, type ImportPayload } from "./cfApi";
import { v4 as uuidv4 } from 'uuid';
import { canonicalizeLangCode } from "../utils/lang";

export type ImportFilmMeta = {
  title: string;
  language: string; // primary
  available_subs: string[];
  cover_url?: string;
  episodes: number;
  total_cards?: number;
  description?: string;
  total_episodes?: number; // new: total intended episodes for this film
  episode_title?: string; // optional: title of current episode being ingested
};

export type ColumnMapping = {
  start: string;
  end: string;
  type?: string;
  sentence?: string; // will be required now
  length?: string; // optional column name for normalized type length
  cefr?: string; // optional column name (CEFR_Level)
  jlpt?: string; // JLPT level N5..N1
  hsk?: string; // HSK level HSK 1..HSK 6
  difficultyScore?: string; // single difficulty metric 0-100 float
  // Generic difficulty frameworks discovered from headers (e.g., difficulty_topik, level_topik_ko)
  frameworkCols?: Array<{ framework: string; header: string; language?: string }>;
  subtitles: Record<string, string>;
};

export interface ImportOptions {
  filmSlug: string; // public slug for paths
  episodeNum: number; // e.g., 1
  filmMeta: ImportFilmMeta; // language can be auto-detected if not provided
  csvText: string;
  storageBucketHost?: string; // not used for R2
  mapping?: ColumnMapping; // if omitted, auto-detect from CSV header
  chunkSize?: number;
  mode?: 'replace' | 'append';
  // New: control card numbering to sync with media
  cardStartIndex?: number; // default 0
  cardPadDigits?: number; // default auto based on total
  // Optional explicit card IDs (e.g., derived from media filenames when Infer IDs is enabled)
  cardIds?: string[];
}

function detectMappingFromHeaders(headers: string[]): { mapping: ColumnMapping; detectedLangs: string[]; primary?: string } {
  // Normalize headers to lowercase for search, but keep original names for direct access
  const lower = headers.map((h) => h.trim());

  // Common header aliases
  const headerOf = (...candidates: string[]) => {
    const idx = lower.findIndex((h) => candidates.some((c) => h.toLowerCase() === c.toLowerCase()));
    return idx >= 0 ? headers[idx] : undefined;
  };

  const start = headerOf("start", "start_time", "start_time_ms", "begin");
  const end = headerOf("end", "end_time", "end_time_ms", "finish");
  const type = headerOf("type");
  const sentence = headerOf("sentence", "text", "line");
  const length = headerOf("length");
  const cefr = headerOf("cefr_level", "cefr", "level_cefr");
  const jlpt = headerOf("jlpt", "jlpt_level", "level_jlpt");
  const hsk = headerOf("hsk", "hsk_level", "level_hsk");
  // Unified difficulty score (0-100). Accept legacy aliases and band columns; band (1-5) will be scaled.
  const difficultyScoreRaw = headerOf("difficulty_score", "score", "difficulty_percent", "difficulty", "diff", "card_difficulty");

  // Language label aliases mapping -> canonical code
  const langAliases: Record<string, string> = {
    english: "en",
    en: "en",
    vietnamese: "vi",
    vi: "vi",
    chinese: "zh",
    chinese_simplified: "zh",
    zh: "zh",
    japanese: "ja",
    ja: "ja",
    korean: "ko",
    ko: "ko",
    indonesian: "id",
    id: "id",
    thai: "th",
    th: "th",
    malay: "ms",
    ms: "ms",
  };

  const subtitles: Record<string, string> = {};
  const detected: string[] = [];
  for (const h of headers) {
    const key = h.trim().toLowerCase().replace(/\s+\(.*\)$/g, ""); // strip (Simplified), etc.
    const canon = canonicalizeLangCode(langAliases[key] || key) || (langAliases[key] || "");
    if (canon && ["en","vi","zh","ja","ko","id","th","ms","zh_trad","yue"].includes(canon)) {
      subtitles[canon] = h; detected.push(canon);
    }
  }
  // Choose primary: prefer en if present, else first detected
  const primary = detected.includes("en") ? "en" : detected[0];

  if (!start || !end) {
    throw new Error("CSV must include 'start' and 'end' columns");
  }

  // Discover any additional difficulty framework columns dynamically
  const frameworkCols: Array<{ framework: string; header: string; language?: string }> = [];
  const knownFrameworks = new Set(["cefr","jlpt","hsk"]);
  const knownLangs = new Set(["en","vi","zh","ja","ko","id","th","ms","zh_trad","yue"]);
  for (const original of headers) {
    const raw = original.trim();
    const key = raw.toLowerCase();
    if (!raw) continue;
    // Skip columns we already mapped (start/end/type/sentence/subtitles/known frameworks/difficulty score)
    if ([start, end, type, sentence, cefr, jlpt, hsk, difficultyScoreRaw].filter(Boolean).includes(raw)) continue;
    const lowerStripped = key.replace(/\s+\(.*\)$/g, "");
    if (subtitles[lowerStripped]) continue;
    // Patterns supported:
    //  - difficulty_<framework>[_<lang>] / diff_<framework>[_<lang>]
    //  - level_<framework>[_<lang>]
    //  - <framework>_level[_<lang>]
    //  - <framework> (bare) if framework name is recognizable
    const patterns: RegExp[] = [
      /^(?:difficulty|diff|level)[_:\-/ ]?([a-z0-9]+?)(?:[_:\-/ ]([a-z_]{2,8}))?$/i,
      /^([a-z0-9]+?)[_:\-/ ](?:level|difficulty)(?:[_:\-/ ]([a-z_]{2,8}))?$/i,
    ];
    let fw: string | undefined;
    let lang: string | undefined;
    for (const re of patterns) {
      const m = lowerStripped.match(re);
      if (m) {
        fw = m[1];
        lang = m[2];
        break;
      }
    }
    if (!fw) {
      // As a fallback: if header equals a likely framework token (e.g., topik), take it
      const token = lowerStripped.replace(/[^a-z0-9_]/g, "");
      if (token && token.length >= 3 && !knownLangs.has(token) && !knownFrameworks.has(token)) {
        fw = token;
      }
    }
    if (!fw) continue;
    const fwUpper = fw.toUpperCase();
    // Infer language defaults for known frameworks
    let fwLang: string | undefined = lang?.toLowerCase();
    if (!fwLang) {
      if (fwUpper === "CEFR") fwLang = "en";
      else if (fwUpper === "JLPT") fwLang = "ja";
      else if (fwUpper === "HSK") fwLang = "zh";
      else if (fwUpper === "TOPIK") fwLang = "ko";
    } else {
      // canonicalize if possible
      fwLang = canonicalizeLangCode(fwLang) || fwLang;
    }
    frameworkCols.push({ framework: fwUpper, header: original, language: fwLang });
  }

  return { mapping: { start, end, type, sentence, length, cefr, jlpt, hsk, difficultyScore: difficultyScoreRaw, frameworkCols, subtitles }, detectedLangs: detected, primary };
}

export async function importFilmFromCsv(opts: ImportOptions, onProgress?: (done: number, total: number) => void) {
  const { filmSlug, episodeNum, filmMeta, csvText } = opts;

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    throw new Error("CSV parse error: " + parsed.errors[0].message);
  }

  const rows: Record<string, string>[] = (parsed.data as unknown as Record<string, string>[]);
  const total = rows.length;
  const padWidthAuto = Math.max(3, String(Math.max(0, total - 1)).length);
  const padWidth = Math.max(1, opts.cardPadDigits || padWidthAuto);
  const baseIndex = Math.max(0, opts.cardStartIndex || 0);
  const explicitIds = Array.isArray(opts.cardIds) ? opts.cardIds.filter(Boolean) : null;

  // Detect mapping if not provided
  const headerFields = parsed.meta?.fields || Object.keys(rows[0] || {});
  const auto = detectMappingFromHeaders(headerFields);
  const mapping = opts.mapping || auto.mapping;

  // Enforce required columns: start, end, sentence, type
  if (!mapping.sentence) throw new Error("CSV must include 'sentence' column");
  if (!mapping.type) throw new Error("CSV must include 'type' column (normalized text)");

  // Assemble film meta with detected languages and primary
  const mainLang = filmMeta.language || auto.primary || "en";
  const available = Array.from(new Set([...(filmMeta.available_subs || []), ...auto.detectedLangs]));
  const meta = { ...filmMeta, language: mainLang, available_subs: available, total_cards: total };

  const cards = rows.map((row, index) => {
    // If explicit IDs provided and count matches total rows, use them as display IDs
    const useExplicit = explicitIds && explicitIds.length === total;
    const displayId = useExplicit
      ? String(explicitIds![index])
      : String(baseIndex + index).padStart(padWidth, "0");
    const parsedNum = parseInt(displayId, 10);
    const card_number = Number.isFinite(parsedNum) ? parsedNum : (baseIndex + index);
  const start = parseFloat((row[mapping.start] || "0").replace(",", "."));
  const end = parseFloat((row[mapping.end] || "0").replace(",", "."));
  const sentenceVal = mapping.sentence ? (row[mapping.sentence] || "").toString().trim() : "";
  const typeVal = mapping.type ? (row[mapping.type] || "").toString().trim() : "";
  if (!sentenceVal) throw new Error(`Row ${index + 1}: 'sentence' is required`);
  if (!typeVal) throw new Error(`Row ${index + 1}: 'type' is required`);

    // Build R2 URLs using cfApi helper
    // We still build media paths using filmSlug and synthetic episode slug e{episodeNum}
  const episodeSlug = `${filmSlug}_${episodeNum}`;
    const image_url = buildR2MediaUrl({ filmId: filmSlug, episodeId: episodeSlug, cardId: displayId, type: "image" });
    const audio_url = buildR2MediaUrl({ filmId: filmSlug, episodeId: episodeSlug, cardId: displayId, type: "audio" });

  const subtitle: Record<string, string> = {};
    Object.entries(mapping.subtitles || {}).forEach(([canon, header]) => {
      const c = canonicalizeLangCode(canon) || canon;
      subtitle[c] = (row[header]?.trim?.() as string) ?? "";
    });

    // Difficulty frameworks collected into array for backend new schema
  const difficulty_levels: Array<{ framework: string; level: string; language?: string }> = [];
    const cefrLevel = mapping.cefr ? (row[mapping.cefr] || "").toString().trim() : "";
    if (cefrLevel) difficulty_levels.push({ framework: "CEFR", level: cefrLevel, language: "en" });
    const jlptLevel = mapping.jlpt ? (row[mapping.jlpt] || "").toString().trim() : "";
    if (jlptLevel) difficulty_levels.push({ framework: "JLPT", level: jlptLevel, language: "ja" });
    const hskLevel = mapping.hsk ? (row[mapping.hsk] || "").toString().trim() : "";
    if (hskLevel) difficulty_levels.push({ framework: "HSK", level: hskLevel, language: "zh" });
    const difficultyScoreVal = mapping.difficultyScore ? (row[mapping.difficultyScore] || "").toString().trim() : "";
    let difficultyScoreNum = difficultyScoreVal ? Number(difficultyScoreVal) : undefined;
    // If value looks like a 1-5 band, scale to 0-100
    if (Number.isFinite(difficultyScoreNum) && difficultyScoreNum != null) {
      if (difficultyScoreNum <= 5) {
        difficultyScoreNum = (difficultyScoreNum / 5) * 100;
      }
    }

    // Dynamic frameworks from discovered headers
    if (Array.isArray(mapping.frameworkCols)) {
      for (const col of mapping.frameworkCols) {
        const v = (row[col.header] || "").toString().trim();
        if (!v) continue;
        difficulty_levels.push({ framework: col.framework, level: v, language: col.language });
      }
    }

    return {
      id: uuidv4(), // internal UUID (not used client-side yet)
      card_number,
      start,
      end,
      episode: episodeNum,
      episode_id: episodeSlug,
      film_id: filmSlug,
      subtitle,
  type: typeVal,
  sentence: sentenceVal,
  // Length handling: if CSV provides an explicit numeric value in "length" column, use it;
  // otherwise compute from normalized `type` (strip all whitespace and count characters).
  // This keeps scoring consistent even when length column omitted.
  length: (() => {
    const raw = mapping.length ? (row[mapping.length] || "").toString().trim() : "";
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    // Fallback: derived length from normalized type text (remove whitespace)
    const normalized = typeVal.replace(/\s+/g, "");
    return normalized.length;
  })(),
      CEFR_Level: cefrLevel || undefined, // backward compatibility for old clients
      difficulty_levels: difficulty_levels.length ? difficulty_levels : undefined,
  difficulty_score: Number.isFinite(difficultyScoreNum) ? difficultyScoreNum : undefined,
      image_url,
      audio_url,
    };
  });

  const payload: ImportPayload = {
    film: { id: uuidv4(), slug: filmSlug, ...meta },
    episodeNumber: episodeNum,
    cards,
    mode: opts.mode || 'append',
  };

  await apiImport(payload);
  onProgress?.(total, total);
}
