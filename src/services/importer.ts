// Cloudflare D1 importer - sends parsed CSV to Worker API
import Papa from "papaparse";
import { apiImport, buildR2MediaUrl, type ImportPayload } from "./cfApi";
import { v4 as uuidv4 } from 'uuid';
import { canonicalizeLangCode, calculateTextLength } from "../utils/lang";

export type ImportFilmMeta = {
  title: string;
  language: string; // primary
  available_subs: string[];
  cover_url?: string;
  cover_landscape_url?: string;
  episodes: number;
  total_cards?: number;
  description?: string;
  total_episodes?: number; // new: total intended episodes for this film
  episode_title?: string; // optional: title of current episode being ingested
  episode_description?: string; // optional: description of current episode being ingested
  is_original?: boolean; // original version flag (true: source language, false: alternate/dub)
  type?: string; // content type: 'movie', 'series', 'book', 'audio', 'video'
  imdb_score?: number; // IMDB score (0-10)
  category_ids?: string[]; // Array of category IDs or names (will create if name doesn't exist)
};

export type ColumnMapping = {
  start: string;
  end: string;
  type?: string;
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
  // Optional: override which CSV header to use for the Main Language subtitle column
  overrideMainSubtitleHeader?: string;
  // Optional: user-confirmed ambiguous headers mapped to language codes
  // e.g., { id: 'id' } when the CSV uses an 'id' column for Indonesian
  confirmedLanguageHeaders?: Record<string, string>;
  // Optional: actual file extensions for uploaded media (to match database keys with uploaded files)
  // Maps cardId -> extension (e.g., { "0001": "webp", "0002": "jpg" })
  imageExtensions?: Record<string, string>;
  audioExtensions?: Record<string, string>;
  // Optional: for video content, whether it has individual card images (true) or uses episode cover (false)
  videoHasImages?: boolean;
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
  // Note: 'sentence' column is no longer used by the system (2025-11)
  const length = headerOf("length");
  // Framework level columns (support both 'cefr_level', 'cefr', and 'CEFR Level' with space)
  const cefr = headerOf("cefr level", "cefr_level", "cefr", "level_cefr");
  const jlpt = headerOf("jlpt level", "jlpt_level", "jlpt", "level_jlpt");
  const hsk = headerOf("hsk level", "hsk_level", "hsk", "level_hsk");
  // Unified difficulty score (0-100). Match specific score column names to avoid confusion with framework columns.
  const difficultyScoreRaw = headerOf("difficulty score", "difficulty_score", "difficultyscore", "score", "difficulty_percent", "card_difficulty");

  // Language label aliases mapping -> canonical code
  const langAliases: Record<string, string> = {
    // Core codes and names
    english: "en", en: "en",
    vietnamese: "vi", vi: "vi",
    chinese: "zh", chinese_simplified: "zh", zh: "zh",
    japanese: "ja", ja: "ja",
    korean: "ko", ko: "ko",
    indonesian: "id", id: "id",
    thai: "th", th: "th",
    malay: "ms", ms: "ms",
    // Extended list
    arabic: "ar", ar: "ar",
    basque: "eu", eu: "eu",
    bengali: "bn", bn: "bn",
    cantonese: "yue", yue: "yue", "zh-yue": "yue", zh_yue: "yue",
    catalan: "ca", ca: "ca",
    "chinese traditional": "zh_trad", "chinese (traditional)": "zh_trad", traditional_chinese: "zh_trad", zh_trad: "zh_trad", "zh-tw": "zh_trad", zh_tw: "zh_trad",
    "chinese simplified": "zh", "chinese (simplified)": "zh",
    croatian: "hr", hr: "hr",
    czech: "cs", cs: "cs",
    danish: "da", da: "da",
    dutch: "nl", nl: "nl",
    filipino: "fil", tagalog: "fil", fil: "fil", tl: "fil",
    finnish: "fi", fi: "fi",
    french: "fr", fr: "fr",
    "french canadian": "fr_ca", "french (canada)": "fr_ca", fr_ca: "fr_ca",
    galician: "gl", gl: "gl",
    german: "de", de: "de",
    greek: "el", el: "el",
    hebrew: "he", he: "he", iw: "he",
    hindi: "hi", hi: "hi",
    hungarian: "hu", hu: "hu",
    icelandic: "is", is: "is",
    italian: "it", it: "it",
    malayalam: "ml", ml: "ml",
    norwegian: "no", no: "no",
    "norwegian bokmal": "nb", "norwegian bokmål": "nb", nb: "nb", bokmal: "nb", bokmål: "nb",
    polish: "pl", pl: "pl",
    pt: "pt", portuguese_base: "pt",
    "portuguese (brazil)": "pt_br", pt_br: "pt_br",
    "portuguese (portugal)": "pt_pt", pt_pt: "pt_pt", portuguese: "pt_pt",
    "portugese (brazil)": "pt_br", "portugese (portugal)": "pt_pt", portugese: "pt_pt",
    romanian: "ro", ro: "ro",
    russian: "ru", ru: "ru",
    es: "es", spanish_base: "es",
    "spanish (latin america)": "es_la", es_la: "es_la",
    "spanish (spain)": "es_es", es_es: "es_es", spanish: "es_es",
    swedish: "sv", sv: "sv",
    tamil: "ta", ta: "ta",
    telugu: "te", te: "te",
    turkish: "tr", tr: "tr",
    ukrainian: "uk", uk: "uk",
    persian: "fa", farsi: "fa", fa: "fa",
    kurdish: "ku", ku: "ku",
    "central kurdish": "ckb", sorani: "ckb", "kurdish (sorani)": "ckb", ckb: "ckb",
    "northern kurdish": "kmr", kurmanji: "kmr", "kurdish (kurmanji)": "kmr", kmr: "kmr",
    "southern kurdish": "sdh", sdh: "sdh",
    slovenian: "sl", sl: "sl",
    serbian: "sr", sr: "sr",
    bulgarian: "bg", bg: "bg",
    latvian: "lv", lv: "lv",
    "northern sami": "se", "sami (northern)": "se", "sami": "se", se: "se", sme: "se",
    urdu: "ur", ur: "ur",
    albanian: "sq", sq: "sq",
    lithuanian: "lt", lt: "lt",
    kazakh: "kk", kk: "kk",
    slovak: "sk", sk: "sk",
    uzbek: "uz", uz: "uz",
    belarusian: "be", be: "be",
    bosnian: "bs", bs: "bs",
    marathi: "mr", mr: "mr",
    mongolian: "mn", mn: "mn",
    estonian: "et", et: "et",
    armenian: "hy", hy: "hy"
  };

  const subtitles: Record<string, string> = {};
  const detected: string[] = [];
  
  // Reserved columns: these are CSV metadata/structural columns, NOT language codes
  // Prevents false positives like "id" (Indonesian), "no" (Norwegian), etc.
  const RESERVED_COLUMNS = new Set([
    "id", "card_id", "cardid", "card id",
    "no", "number", "card_number", "cardnumber", "card number",
    "start", "start_time", "starttime", "start time", "start_time_ms",
    "end", "end_time", "endtime", "end time", "end_time_ms",
    "duration", "length", "card_length",
    "type", "card_type", "cardtype", "card type",
    "sentence", "text", "content",
    "image", "image_url", "imageurl", "image url", "image_key",
    "audio", "audio_url", "audiourl", "audio url", "audio_key",
    "difficulty", "difficulty_score", "difficultyscore", "difficulty score",
    "cefr", "cefr_level", "cefr level",
    "jlpt", "jlpt_level", "jlpt level",
    "hsk", "hsk_level", "hsk level",
    "notes", "tags", "metadata",
    "hiragana", "katakana", "romaji"
  ]);
  
  for (const h of headers) {
    // IMPORTANT: Only strip square brackets [CC], [SDH] etc., NOT round parentheses (Brazil), (Spain), (Traditional)
    // Round parentheses contain variant information critical for language detection
    const key = h.trim().toLowerCase().replace(/\s*\[[^\]]*\]\s*/g, '').trim(); // strip [CC] only, keep (Brazil)
    
    // Skip reserved columns BEFORE language detection
    if (RESERVED_COLUMNS.has(key)) continue;
    
    const canon = (langAliases[key] as string) || canonicalizeLangCode(key) || "";
    if (canon && [
      "ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","nb","pl","pt","pt_br","pt_pt","ro","ru","es","es_la","es_es","sv","se","ta","te","th","tr","uk","vi","lv","fa","ku","ckb","kmr","sdh","sl","sr","bg","ur","sq","lt","kk","sk","uz","be","bs","mr","mn","et","hy"
    ].includes(canon)) {
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
  for (const original of headers) {
    const raw = original.trim();
    const key = raw.toLowerCase();
    if (!raw) continue;
    // Skip columns we already mapped (start/end/type/length/known frameworks/difficulty score)
    if ([start, end, type, length, cefr, jlpt, hsk, difficultyScoreRaw].filter(Boolean).includes(raw)) continue;
    const lowerStripped = key.replace(/\s*[([].*?[)\]]\s*/g, "");
    // Skip subtitle columns by matching original header against mapped subtitle headers
    if (Object.values(subtitles).includes(original)) continue;
    // Patterns supported for dynamic frameworks ONLY:
    //  - difficulty_<framework>[_<lang>]
    //  - diff_<framework>[_<lang>]
    const patterns: RegExp[] = [
      /^(?:difficulty|diff)[_:\-/ ]?([a-z0-9]+?)(?:[_:\-/ ]([a-z_]{2,8}))?$/i,
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
    if (!fw) continue;
    const fwUpper = fw.toUpperCase();
    // Exclude score/percent columns (these are difficulty_score, not frameworks)
    if (fwUpper === 'SCORE' || fwUpper === 'PERCENT') continue;
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

  return { mapping: { start, end, type, length, cefr, jlpt, hsk, difficultyScore: difficultyScoreRaw, frameworkCols, subtitles }, detectedLangs: detected, primary };
}

export async function importFilmFromCsv(opts: ImportOptions, onProgress?: (done: number, total: number) => void) {
  const { filmSlug, episodeNum, filmMeta, csvText } = opts;

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    throw new Error("CSV parse error: " + parsed.errors[0].message);
  }

  const rows: Record<string, string>[] = (parsed.data as unknown as Record<string, string>[]);
  const total = rows.length;
  const padWidthAuto = Math.max(4, String(Math.max(0, total - 1)).length);
  const padWidth = Math.max(1, opts.cardPadDigits || padWidthAuto);
  const baseIndex = Math.max(0, opts.cardStartIndex || 0);
  const explicitIds = Array.isArray(opts.cardIds) ? opts.cardIds.filter(Boolean) : null;

  // Detect mapping if not provided
  const headerFields = parsed.meta?.fields || Object.keys(rows[0] || {});
  const auto = detectMappingFromHeaders(headerFields);
  const baseMapping = opts.mapping || auto.mapping;
  // Make a shallow-cloned mapping we can safely adjust
  const mapping: ColumnMapping = { ...baseMapping, subtitles: { ...(baseMapping.subtitles || {}) } };

  // Enforce required columns: start, end (Type is optional)

  // Assemble film meta with detected languages and primary
  const mainLang = filmMeta.language || auto.primary || "en";
  // If the caller specifies an override header for the main language, apply it
  if (opts.overrideMainSubtitleHeader) {
    const mainCanon = canonicalizeLangCode(mainLang) || mainLang;
    // Only apply if the header actually exists in the CSV
    if ((headerFields as string[]).includes(opts.overrideMainSubtitleHeader)) {
      mapping.subtitles[mainCanon] = opts.overrideMainSubtitleHeader;
    }
  }
  // Apply confirmed ambiguous language headers (e.g., 'id' → Indonesian)
  if (opts.confirmedLanguageHeaders) {
    for (const [lang, header] of Object.entries(opts.confirmedLanguageHeaders)) {
      const canon = canonicalizeLangCode(lang) || lang.toLowerCase();
      if ((headerFields as string[]).includes(header)) {
        mapping.subtitles[canon] = header;
      }
    }
  }
  const extraConfirmed = opts.confirmedLanguageHeaders ? Object.keys(opts.confirmedLanguageHeaders).map(l => canonicalizeLangCode(l) || l.toLowerCase()) : [];
  const available = Array.from(new Set([...(filmMeta.available_subs || []), ...auto.detectedLangs, ...extraConfirmed]));
  const meta = { ...filmMeta, language: mainLang, available_subs: available, total_cards: total };
  // mainCanon retained for potential future use but not required for import generation

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
    const typeVal = mapping.type ? (row[mapping.type] || "").toString().trim() : ""; // may be empty

    function normalizeType(raw: string, subs: Record<string, string>, mainLangCode: string) {
      if (!raw) return "";
      let s = raw.replace(/\[[^\]]+\]/g, "").replace(/\([^)]*\)/g, "");
      s = s.replace(/\s+/g, " ").trim();
      const lower = s.toLowerCase();
      if (lower === "narration" || lower === "dialogue" || lower === "narrator") {
        const mainCanon = canonicalizeLangCode(mainLangCode) || mainLangCode;
        const mainText = subs[mainCanon] || "";
        return (mainText || "").trim();
      }
      return s;
    }

    const episodeSlug = `${filmSlug}_${String(episodeNum).padStart(3,'0')}`; // padded for consistency with storage paths
    
    // Determine actual file extensions from uploaded files (if provided), otherwise default to legacy
    const cardIdStr = String(displayId).padStart(4, '0');
    const imageExt = opts.imageExtensions?.[cardIdStr] || opts.imageExtensions?.[String(displayId)] || "jpg";
    const audioExt = opts.audioExtensions?.[cardIdStr] || opts.audioExtensions?.[String(displayId)] || "mp3";
    
    // For video content without images: don't set image_url (will use episode cover_key instead)
    // For video content with images or other content types: build image_url as usual
    const isVideoContent = filmMeta.type === 'video';
    const videoUsesEpisodeCover = isVideoContent && opts.videoHasImages === false;
    const image_url = videoUsesEpisodeCover ? undefined : buildR2MediaUrl({ filmId: filmSlug, episodeId: `e${String(episodeNum).padStart(3,'0')}`, cardId: displayId, type: "image", ext: imageExt });
    const audio_url = buildR2MediaUrl({ filmId: filmSlug, episodeId: `e${String(episodeNum).padStart(3,'0')}`, cardId: displayId, type: "audio", ext: audioExt });

    const subtitle: Record<string, string> = {};
    Object.entries(mapping.subtitles || {}).forEach(([canon, header]) => {
      const c = canonicalizeLangCode(canon) || canon;
      const text = (row[header]?.trim?.() as string) ?? "";
      if (text && text.trim()) {
        subtitle[c] = text;
      }
    });

    // Always set sentence from Main Language subtitle column value (raw), even if unavailable
    const mainCanon = canonicalizeLangCode(mainLang) || mainLang;
    const mainHeader = (mapping.subtitles || {})[mainCanon];
    const mainText = mainHeader ? ((row[mainHeader] as string) ?? "").trim() : "";
    const sentence = mainText || "";

    // Availability rule (updated): Only depend on Main Language cell.
    // If Main Language cell is empty -> Unavailable; missing other subtitles do NOT affect availability.
    const isAvailable = !!mainText;

    const difficulty_levels: Array<{ framework: string; level: string; language?: string }> = [];
    const cefrLevel = mapping.cefr ? (row[mapping.cefr] || "").toString().trim() : "";
    if (cefrLevel) difficulty_levels.push({ framework: "CEFR", level: cefrLevel, language: "en" });
    const jlptLevel = mapping.jlpt ? (row[mapping.jlpt] || "").toString().trim() : "";
    if (jlptLevel) difficulty_levels.push({ framework: "JLPT", level: jlptLevel, language: "ja" });
    const hskLevel = mapping.hsk ? (row[mapping.hsk] || "").toString().trim() : "";
    if (hskLevel) difficulty_levels.push({ framework: "HSK", level: hskLevel, language: "zh" });
    const difficultyScoreVal = mapping.difficultyScore ? (row[mapping.difficultyScore] || "").toString().trim() : "";
    let difficultyScoreNum = difficultyScoreVal ? Number(difficultyScoreVal) : undefined;
    if (Number.isFinite(difficultyScoreNum) && difficultyScoreNum != null) {
      if (difficultyScoreNum <= 5) {
        difficultyScoreNum = (difficultyScoreNum / 5) * 100;
      }
    }
    if (Array.isArray(mapping.frameworkCols)) {
      for (const col of mapping.frameworkCols) {
        const v = (row[col.header] || "").toString().trim();
        if (!v) continue;
        difficulty_levels.push({ framework: col.framework, level: v, language: col.language });
      }
    }

    const sanitizedType = normalizeType(typeVal, subtitle, mainLang);

    return {
      id: uuidv4(),
      card_number,
      start,
      end,
      episode: episodeNum,
      episode_id: episodeSlug,
      film_id: filmSlug,
      subtitle,
      sentence, // always from main language subtitle
      type: sanitizedType,
      length: (() => {
        const raw = mapping.length ? (row[mapping.length] || "").toString().trim() : "";
        if (raw) {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) return Math.floor(n);
        }
        if (sanitizedType) {
          return calculateTextLength(sanitizedType, mainCanon);
        }
        const mainText = subtitle[mainCanon] || "";
        if (mainText) {
          return calculateTextLength(mainText, mainCanon);
        }
        for (const [langCode, textVal] of Object.entries(subtitle)) {
          if (textVal && textVal.trim()) {
            return calculateTextLength(textVal, langCode);
          }
        }
        return 0;
      })(),
      CEFR_Level: cefrLevel || undefined,
      difficulty_levels: difficulty_levels.length ? difficulty_levels : undefined,
      difficulty_score: Number.isFinite(difficultyScoreNum) ? difficultyScoreNum : undefined,
      image_url,
      audio_url,
      is_available: isAvailable,
    };
  });

  const payload: ImportPayload = {
    film: { 
      id: uuidv4(), 
      slug: filmSlug, 
      ...meta,
      imdb_score: filmMeta.imdb_score,
      category_ids: filmMeta.category_ids || [],
    },
    episodeNumber: episodeNum,
    cards,
    mode: opts.mode || 'append',
  };

  await apiImport(payload);
  onProgress?.(total, total);
}
