import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { useUser } from "../../context/UserContext";
import { importFilmFromCsv, type ImportFilmMeta } from "../../services/importer";
import {
  uploadCoverImage,
  uploadMediaBatch,
  uploadEpisodeCoverImage,
  uploadEpisodeFullMedia,
} from "../../services/storageUpload";
import type { MediaType } from "../../services/storageUpload";
import { apiUpdateEpisodeMeta, apiGetFilm, apiCalculateStats, apiDeleteItem } from "../../services/cfApi";
import { getAvailableMainLanguages, invalidateGlobalCardsCache } from "../../services/firestore";
import { XCircle, CheckCircle, AlertTriangle, HelpCircle, Film, Clapperboard, Book as BookIcon, AudioLines, Loader2, RefreshCcw } from "lucide-react";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "../../types/content";
import type { ContentType } from "../../types/content";
import { langLabel, canonicalizeLangCode, expandCanonicalToAliases } from "../../utils/lang";
import ProgressBar from "../../components/ProgressBar";
import FlagDisplay from "../../components/FlagDisplay";

export default function AdminContentIngestPage() {
  const { user, signInGoogle, adminKey, preferences: globalPreferences, setMainLanguage: setGlobalMainLanguage } = useUser();
  const allowedEmails = useMemo(
    () => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean),
    []
  );
  const pass = (import.meta.env.VITE_IMPORT_KEY || "").toString();
  const requireKey = !!pass;
  const isAdmin = !!user && allowedEmails.includes(user.email || "") && (!requireKey || adminKey === pass);

  // Content meta state
  const [filmId, setFilmId] = useState("");
  const [episodeNum] = useState<number>(1);
  const [title, setTitle] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  // Slug uniqueness check state
  const [slugChecked, setSlugChecked] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null); // null: not checked
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [isOriginal, setIsOriginal] = useState<boolean>(true);
  const [slugChecking, setSlugChecking] = useState(false);
  const [releaseYear, setReleaseYear] = useState<number | "">("");
  const [mainLanguage, setMainLanguage] = useState<string>("en");

  // Dropdown state
  const [langOpen, setLangOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement | null>(null);
  const typeDropdownRef = useRef<HTMLDivElement | null>(null);
  const yearDropdownRef = useRef<HTMLDivElement | null>(null);
  // Language dropdown helpers
  const [langQuery, setLangQuery] = useState("");

  const ALL_LANG_OPTIONS: string[] = [
    "en","vi","ja","ko","zh","zh_trad","id","th","ms","yue",
    "ar","eu","bn","ca","hr","cs","da","nl","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","it","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","tr","uk",
    "fa","ku","sl","sr","bg"
  ];
  const SORTED_LANG_OPTIONS = useMemo(() => {
    // Sort by human-friendly label A->Z
    return [...ALL_LANG_OPTIONS].sort((a, b) => langLabel(a).localeCompare(langLabel(b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const FILTERED_LANG_OPTIONS = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return SORTED_LANG_OPTIONS;
    return SORTED_LANG_OPTIONS.filter(l => {
      const label = `${langLabel(l)} (${l})`.toLowerCase();
      return label.includes(q);
    });
  }, [langQuery, SORTED_LANG_OPTIONS]);

  // CSV & validation state
  const [csvText, setCsvText] = useState("");
  const csvRef = useRef<HTMLInputElement | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvValid, setCsvValid] = useState<boolean | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  // Allow selecting which CSV header to treat as Main Language subtitle
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string>("");

  // Media selection state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);

  // Optional media toggles (film-level full media removed per new schema)
  const [addCover, setAddCover] = useState(false);
  const [addEpCover, setAddEpCover] = useState(false);
  const [addEpAudio, setAddEpAudio] = useState(false);
  const [addEpVideo, setAddEpVideo] = useState(false);
  const [epFullAudioExt, setEpFullAudioExt] = useState<'mp3' | 'wav'>('mp3');

  // Progress state
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [coverDone, setCoverDone] = useState(0);
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [epFullAudioDone, setEpFullAudioDone] = useState(0);
  const [epFullVideoDone, setEpFullVideoDone] = useState(0);
  const [epFullVideoBytesDone, setEpFullVideoBytesDone] = useState(0);
  const [epFullVideoBytesTotal, setEpFullVideoBytesTotal] = useState(0);
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [audioTotal, setAudioTotal] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [statsDone, setStatsDone] = useState(false);
  // Cancel / abort controls
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);
  // Rollback tracking: track what was created so we can clean up on error/cancel
  const createdFilmRef = useRef<string | null>(null);
  const createdEpisodeNumRef = useRef<number | null>(null);
  const importSucceededRef = useRef<boolean>(false);
  // File presence flags for optional uploads (to drive validation reliably)
  const [hasCoverFile, setHasCoverFile] = useState(false);
  const [hasEpCoverFile, setHasEpCoverFile] = useState(false);
  const [hasEpAudioFile, setHasEpAudioFile] = useState(false);
  const [hasEpVideoFile, setHasEpVideoFile] = useState(false);

  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";

  // CSV helpers
  const lowerHeaderMap = useMemo(() => {
    const m: Record<string, string> = {};
    csvHeaders.forEach(h => { m[(h || "").toLowerCase()] = h; });
    return m;
  }, [csvHeaders]);
  const requiredOriginals = useMemo(() => ["start", "end"].map(k => lowerHeaderMap[k]).filter(Boolean) as string[], [lowerHeaderMap]);

  const validateCsv = useCallback((headers: string[], rows: Record<string, string>[]) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const headerMap: Record<string, string> = {};
    headers.forEach(h => { const l = (h || "").toLowerCase(); if (!headerMap[l]) headerMap[l] = h; });
    // Reserved columns: these are CSV metadata/structural columns, NOT language codes
    // Prevents false positives like "id" (Indonesian), "no" (Norwegian), "type", "end" (English partial), etc.
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
      // Script helper columns (ignore silently)
      "hiragana", "katakana", "romaji"
    ]);
    // Không cho phép cột sentence
    if (headerMap["sentence"]) {
      errors.push("Không được truyền cột 'sentence' trong CSV. Hệ thống sẽ tự động lấy subtitle của Main Language để điền vào.");
    }
    const required = ["start", "end"]; // Type is optional
    const missing = required.filter(r => !headerMap[r]);
    if (missing.length) {
      errors.push(`Thiếu cột bắt buộc: ${missing.join(", ")}`);
    }
    // language detection (strict variant matching)
    const recognizedSubtitleHeaders = new Set<string>();
    const SUPPORTED_CANON = ["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","th","tr","uk","vi","fa","ku","sl","sr","bg"] as const;
    const aliasMap: Record<string,string> = {};
    SUPPORTED_CANON.forEach(c => { expandCanonicalToAliases(c).forEach(a => { aliasMap[a.toLowerCase()] = c; }); });
    // Common misspellings / fallbacks
    aliasMap["portugese"] = "pt_pt";
    aliasMap["portugese (portugal)"] = "pt_pt";
    aliasMap["portugese (brazil)"] = "pt_br";
    const norm = (s: string) => s.trim().toLowerCase();
    headers.forEach(h => {
      const rawLow = norm(h);
      // Remove bracketed qualifiers like [CC], [SDH], [Captions] and trim again
      const cleaned = rawLow.replace(/\s*\[[^\]]*\]\s*/g, '').trim();
      // Skip reserved columns BEFORE language detection
      if (RESERVED_COLUMNS.has(cleaned)) return;
      // Direct alias match (after cleaning)
      if (aliasMap[cleaned]) { recognizedSubtitleHeaders.add(h); return; }
      // Parentheses variant form e.g. Chinese (Traditional), Spanish (Spain)
      const m = cleaned.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/);
      if (m) {
        const base = m[1];
        const variant = m[2];
        if (base === 'chinese') {
          if (/(?:trad|traditional|hant|hk|tw|mo)/.test(variant)) { recognizedSubtitleHeaders.add(h); return; }
          if (/(?:simplified|hans|cn)/.test(variant)) { recognizedSubtitleHeaders.add(h); return; }
        }
        if (aliasMap[base]) { recognizedSubtitleHeaders.add(h); }
      }
    });
    const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    const mainAliases = new Set(expandCanonicalToAliases(mainCanon).map(a => a.toLowerCase()));
    // Explicit variant alias forms (with parentheses) for strict presence check
    if (mainCanon === 'es_la') {
      mainAliases.add('spanish (latin america)');
      mainAliases.add('spanish latin america');
    } else if (mainCanon === 'es_es') {
      mainAliases.add('spanish (spain)');
      mainAliases.add('spanish spain');
    } else if (mainCanon === 'pt_br') {
      mainAliases.add('portuguese (brazil)');
      mainAliases.add('portugese (brazil)');
      mainAliases.add('brazilian portuguese');
    } else if (mainCanon === 'pt_pt') {
      mainAliases.add('portuguese (portugal)');
      mainAliases.add('portugese (portugal)');
    }
    // Robust presence check: normalize headers & aliases; also allow base-with-parentheses mapping.
    const normStrict = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '').trim();
    const mainAliasesStrict = new Set(Array.from(mainAliases).map(a => normStrict(a)));
    let hasMainLangColumn = false;
    for (const h of headers) {
      const hStrict = normStrict(h);
      if (mainAliasesStrict.has(hStrict)) { hasMainLangColumn = true; break; }
      const rawLow = norm(h);
      const low = rawLow.replace(/\s*\[[^\]]*\]\s*/g, '').trim();
      // Direct canonical code match (e.g. es_es, pt_br)
      const directCanon = aliasMap[low];
      if (directCanon === mainCanon) { hasMainLangColumn = true; break; }
      // Parentheses variant form (Spanish (Spain), Chinese (Traditional), etc.)
      const m2 = low.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/);
      if (m2) {
        const base = m2[1];
        const variant = m2[2];
        if (base === 'spanish') {
          const isSpain = /(spain)/.test(variant);
          const isLatAm = /(latin\s*america|latam)/.test(variant);
          if (isSpain && mainCanon === 'es_es') { hasMainLangColumn = true; break; }
          if (isLatAm && mainCanon === 'es_la') { hasMainLangColumn = true; break; }
          continue; // do not allow fallback base mapping when a variant is specified
        }
        if (base === 'portuguese' || base === 'portugese') {
          const isBrazil = /(brazil)/.test(variant);
          const isPortugal = /(portugal)/.test(variant);
          if (isBrazil && mainCanon === 'pt_br') { hasMainLangColumn = true; break; }
          if (isPortugal && mainCanon === 'pt_pt') { hasMainLangColumn = true; break; }
          continue;
        }
        if (base === 'chinese') {
          const isTrad = /(trad|traditional|hant|hk|tw|mo)/.test(variant);
          const isSimp = /(simplified|hans|cn)/.test(variant);
          if (isTrad && mainCanon === 'zh_trad') { hasMainLangColumn = true; break; }
          if (isSimp && mainCanon === 'zh') { hasMainLangColumn = true; break; }
          continue;
        }
      }
      // Ambiguous base language (no variant parentheses). Allow if base maps directly AND no parentheses form.
      if (!/\([^)]+\)/.test(low)) {
        const baseCanon = aliasMap[low];
        if (baseCanon === mainCanon) { hasMainLangColumn = true; break; }
      }
    }
    if (!hasMainLangColumn) {
      errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon}`);
    }
    // Warn for ignored/unused columns (not required, not known frameworks/difficulty, not subtitles)
    const knownSingles = new Set(["start","end","type","length","cefr","cefr level","cefr_level","jlpt","jlpt level","jlpt_level","hsk","hsk level","hsk_level","difficulty score","difficulty_score","difficultyscore","score","difficulty_percent","card_difficulty"]);
    const isFrameworkDynamic = (raw: string) => {
      const key = raw.trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      return /^(?:difficulty|diff)[_:\-/ ]?[a-z0-9]+(?:[_:\-/ ][a-z_]{2,8})?$/i.test(key);
    };
    const ignored: string[] = [];
    for (const h of headers) {
      const raw = (h || '').trim();
      if (!raw) continue;
      const low = raw.toLowerCase();
      if (RESERVED_COLUMNS.has(low)) continue; // Skip reserved metadata columns
      if (knownSingles.has(low)) continue;
      if (recognizedSubtitleHeaders.has(raw)) continue;
      if (isFrameworkDynamic(raw)) continue;
      if (low === 'sentence') continue; // already an error above
      ignored.push(raw);
    }
    if (ignored.length) {
      warnings.push(`Các cột sẽ bị bỏ qua: ${ignored.join(', ')}`);
    }
    // row required cell checks (limit to 50 errors)
    let ec = 0;
    const maxErr = 50;
    rows.forEach((row, i) => {
      required.forEach(k => {
        const orig = headerMap[k];
        const v = orig ? (row[orig] || "").toString().trim() : "";
        if (!v) { errors.push(`Hàng ${i + 2}: cột "${k}" trống.`); ec++; }
      });
      if (ec >= maxErr) return;
    });
    setCsvErrors(errors);
    setCsvWarnings(warnings);
    setCsvValid(errors.length === 0);
  }, [mainLanguage]);

  // Derive list for footnote display (kept in sync with validateCsv rules)
  const ignoredHeaders = useMemo(() => {
    if (!csvHeaders.length) return [] as string[];
    const langAliases: Record<string, string> = {
      english: "en", eng: "en", vietnamese: "vi", vn: "vi",
      chinese: "zh", "chinese simplified": "zh", chinese_simplified: "zh", zh: "zh", cn: "zh", "zh-cn": "zh", zh_cn: "zh", "zh-hans": "zh", zh_hans: "zh", "zh-hans-cn": "zh", zh_hans_cn: "zh", "zh-simplified": "zh", zh_simplified: "zh",
      "chinese traditional": "zh_trad", "traditional chinese": "zh_trad", traditional_chinese: "zh_trad", zh_trad: "zh_trad", "zh-tw": "zh_trad", zh_tw: "zh_trad", "zh-hant": "zh_trad", zh_hant: "zh_trad", "zh-hk": "zh_trad", zh_hk: "zh_trad", "zh-mo": "zh_trad", zh_mo: "zh_trad", "zh-hant-tw": "zh_trad", zh_hant_tw: "zh_trad", "zh-hant-hk": "zh_trad", zh_hant_hk: "zh_trad", tw: "zh_trad",
      japanese: "ja", ja: "ja", jp: "ja", korean: "ko", ko: "ko", kr: "ko",
      indonesian: "id", id: "id", "in": "id", thai: "th", th: "th", malay: "ms", ms: "ms", my: "ms",
      cantonese: "yue", yue: "yue", "zh-yue": "yue", zh_yue: "yue",
      arabic: "ar", ar: "ar", basque: "eu", eu: "eu", bengali: "bn", bn: "bn", catalan: "ca", ca: "ca", croatian: "hr", hr: "hr", czech: "cs", cs: "cs", danish: "da", da: "da", dutch: "nl", nl: "nl",
      filipino: "fil", fil: "fil", tagalog: "fil", tl: "fil", finnish: "fi", fi: "fi",
      french: "fr", fr: "fr", "french canadian": "fr_ca", fr_ca: "fr_ca", frcan: "fr_ca",
      galician: "gl", gl: "gl", german: "de", de: "de", greek: "el", el: "el", hebrew: "he", he: "he", iw: "he", hindi: "hi", hi: "hi", hungarian: "hu", hu: "hu", icelandic: "is", is: "is", italian: "it", it: "it", malayalam: "ml", ml: "ml", norwegian: "no", no: "no", polish: "pl", pl: "pl",
      portuguese: "pt_pt", pt: "pt_pt", pt_pt: "pt_pt", ptpt: "pt_pt", "portuguese (portugal)": "pt_pt",
      "portuguese (brazil)": "pt_br", pt_br: "pt_br", ptbr: "pt_br", brazilian_portuguese: "pt_br",
      romanian: "ro", ro: "ro", russian: "ru", ru: "ru",
      spanish: "es_es", es: "es_es", es_es: "es_es", "spanish (spain)": "es_es",
      "spanish (latin america)": "es_la", es_la: "es_la", latam_spanish: "es_la",
      swedish: "sv", sv: "sv", tamil: "ta", ta: "ta", telugu: "te", te: "te", turkish: "tr", tr: "tr", ukrainian: "uk", uk: "uk",
      persian: "fa", farsi: "fa", fa: "fa",
      kurdish: "ku", ku: "ku",
      slovenian: "sl", sl: "sl",
      serbian: "sr", sr: "sr",
      bulgarian: "bg", bg: "bg"
    };
    const supported = new Set(["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","th","tr","uk","vi","fa","ku","sl","sr","bg"]);
    const recognizedSubtitleHeaders = new Set<string>();
    
    // Same generalized language detection as in validateCsv
    const extractBaseLang = (rawHeader: string): { base: string; variation?: string } => {
      const trimmed = rawHeader.trim().toLowerCase();
      const parenMatch = trimmed.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/);
      if (parenMatch) {
        return { base: parenMatch[1].trim(), variation: parenMatch[2].trim() };
      }
      const hyphenMatch = trimmed.match(/^([a-z]{2,3})[-_](.+)$/);
      if (hyphenMatch) {
        return { base: hyphenMatch[1], variation: hyphenMatch[2] };
      }
      return { base: trimmed };
    };

    csvHeaders.forEach(h => {
      const key = (h || "").trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      const alias = langAliases[key];
      if (alias) {
        recognizedSubtitleHeaders.add(h);
        return;
      }
      if (supported.has(key)) {
        recognizedSubtitleHeaders.add(h);
        return;
      }
      // Generalized pattern matching
      const { base } = extractBaseLang(h);
      const baseAlias = langAliases[base];
      const baseCanon = baseAlias || (supported.has(base) ? base : null);
      if (baseCanon) {
        recognizedSubtitleHeaders.add(h);
      }
    });
    const knownSingles = new Set(["start","end","type","length","cefr","cefr level","cefr_level","jlpt","jlpt level","jlpt_level","hsk","hsk level","hsk_level","difficulty score","difficulty_score","difficultyscore","score","difficulty_percent","card_difficulty"]);
    const isFrameworkDynamic = (raw: string) => {
      const key = raw.trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      return /^(?:difficulty|diff)[_:\-/ ]?[a-z0-9]+(?:[_:\-/ ][a-z_]{2,8})?$/i.test(key);
    };
    const ignored: string[] = [];
    for (const h of csvHeaders) {
      const raw = (h || '').trim(); if (!raw) continue;
      const low = raw.toLowerCase();
      if (knownSingles.has(low)) continue;
      if (recognizedSubtitleHeaders.has(raw)) continue;
      if (isFrameworkDynamic(raw)) continue;
      if (low === 'sentence') continue;
      ignored.push(raw);
    }
    return ignored;
  }, [csvHeaders]);

  function findHeaderForLang(headers: string[], lang: string): string | null {
    // Strict exact alias matching only (ignore case & separators); prefer the variant alias that includes parentheses if both exist.
    const rawAliases = expandCanonicalToAliases(lang);
    const normalizedAliases = rawAliases.map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
    const variantAliases = rawAliases.filter(a => /\(.+\)/.test(a)).map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
    const headerNorms = headers.map(h => ({ orig: h, norm: h.toLowerCase().replace(/[_\s-]/g, "") }));
    // If a variant alias exists (with parentheses) try those first
    for (const v of variantAliases) {
      const found = headerNorms.find(h => h.norm === v);
      if (found) return found.orig;
    }
    for (const a of normalizedAliases) {
      const found = headerNorms.find(h => h.norm === a);
      if (found) return found.orig;
    }
    return null;
  }
  const mainLangHeader = useMemo(() => findHeaderForLang(csvHeaders, mainLanguage), [csvHeaders, mainLanguage]);
  const mainLangHeaderOptions = useMemo(() => {
    const canon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    const variantGroups: Record<string,string[]> = {
      es_es: ["es_es","es_la"], es_la: ["es_es","es_la"],
      pt_pt: ["pt_pt","pt_br"], pt_br: ["pt_pt","pt_br"],
    };
    const targetCanonList = variantGroups[canon] || [canon];
    const candidateSet = new Set<string>();
    const headerCleanMap = csvHeaders.map(h => ({ orig: h, clean: h.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[_\s-]/g, "") }));
    targetCanonList.forEach(c => {
      const aliases = expandCanonicalToAliases(c).map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
      headerCleanMap.forEach(h => { if (aliases.includes(h.clean)) candidateSet.add(h.orig); });
    });
    const candidates = Array.from(candidateSet);
    // Ensure the selected main language's own variant (if present) comes first
    const mainAliasesNorm = expandCanonicalToAliases(canon).map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
    candidates.sort((a, b) => {
      const aIsMain = mainAliasesNorm.includes(a.toLowerCase().replace(/[_\s-]/g, "")) ? 0 : 1;
      const bIsMain = mainAliasesNorm.includes(b.toLowerCase().replace(/[_\s-]/g, "")) ? 0 : 1;
      if (aIsMain !== bIsMain) return aIsMain - bIsMain;
      const aCc = /(\[(?:cc)\]|\(cc\))/i.test(a) ? 1 : 0;
      const bCc = /(\[(?:cc)\]|\(cc\))/i.test(b) ? 1 : 0;
      return aCc - bCc;
    });
    return candidates;
  }, [csvHeaders, mainLanguage]);

  // Keep override in sync with options (choose best default automatically)
  useEffect(() => {
    if (!mainLangHeaderOptions.length) { setMainLangHeaderOverride(''); return; }
    // If user already chose a valid override, keep it.
    if (mainLangHeaderOverride && mainLangHeaderOptions.includes(mainLangHeaderOverride)) return;
    const canon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    const aliasNorms = new Set(expandCanonicalToAliases(canon).map(a => a.toLowerCase().replace(/[_\s-]/g, '')));
    const matching = mainLangHeaderOptions.find(h => aliasNorms.has(h.toLowerCase().replace(/[_\s-]/g, '')));
    setMainLangHeaderOverride(matching || mainLangHeaderOptions[0]);
  }, [mainLangHeaderOptions, mainLanguage, mainLangHeaderOverride]);

  // Effects
  useEffect(() => { if (csvHeaders.length && csvRows.length) validateCsv(csvHeaders, csvRows); }, [csvHeaders, csvRows, validateCsv]);
  useEffect(() => {
    function outside(e: MouseEvent) {
      const t = e.target as Node | null;
      if (langOpen && langDropdownRef.current && t && !langDropdownRef.current.contains(t)) setLangOpen(false);
      if (typeOpen && typeDropdownRef.current && t && !typeDropdownRef.current.contains(t)) setTypeOpen(false);
      if (yearOpen && yearDropdownRef.current && t && !yearDropdownRef.current.contains(t)) setYearOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [langOpen, typeOpen, yearOpen]);

  // Reset file flags when toggles are turned off
  useEffect(() => { if (!addCover) setHasCoverFile(false); }, [addCover]);
  useEffect(() => { if (!addEpCover) setHasEpCoverFile(false); }, [addEpCover]);
  useEffect(() => { if (!addEpAudio) setHasEpAudioFile(false); }, [addEpAudio]);
  useEffect(() => { if (!addEpVideo) setHasEpVideoFile(false); }, [addEpVideo]);

  // Debounced slug availability auto-check
  useEffect(() => {
    const slug = filmId.trim();
    if (!slug) { setSlugChecked(false); setSlugAvailable(null); return; }
    setSlugChecking(true);
    setSlugChecked(false); setSlugAvailable(null);
    const handle = setTimeout(async () => {
      try {
        const film = await apiGetFilm(slug);
        if (film) { setSlugChecked(true); setSlugAvailable(false); }
        else { setSlugChecked(true); setSlugAvailable(true); }
      } finally { setSlugChecking(false); }
    }, 550);
    return () => clearTimeout(handle);
  }, [filmId]);

  // Derived: can the user start creation?
  const canCreate = useMemo(() => {
    const hasUser = !!user;
    const emailOk = hasUser && allowedEmails.includes(user?.email || "");
    const keyOk = !requireKey || adminKey === pass;
    const slugOk = !!filmId && slugChecked && slugAvailable === true;
    const csvOk = csvValid === true;
    const titleOk = (title || "").trim().length > 0;
    const typeOk = !!contentType;
    // Required card media: at least 1 image and 1 audio file
    const cardMediaOk = imageFiles.length > 0 && audioFiles.length > 0;
    // Optional toggles: if checked, require a file chosen for that input (use reactive flags)
    const coverOk = !addCover || hasCoverFile;
    const epCoverOk = !addEpCover || hasEpCoverFile;
    const epAudioOk = !addEpAudio || hasEpAudioFile;
    const epVideoOk = !addEpVideo || hasEpVideoFile;
    const optionalUploadsOk = coverOk && epCoverOk && epAudioOk && epVideoOk;
    return !!(hasUser && emailOk && keyOk && slugOk && csvOk && titleOk && typeOk && cardMediaOk && optionalUploadsOk);
  }, [user, allowedEmails, requireKey, adminKey, pass, filmId, slugChecked, slugAvailable, csvValid, title, contentType, imageFiles.length, audioFiles.length, addCover, addEpCover, addEpAudio, addEpVideo, hasCoverFile, hasEpCoverFile, hasEpAudioFile, hasEpVideoFile]);

  // Handlers
  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    setCsvFileName(f.name);
    try {
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
      const headers = (parsed.meta.fields || []).map(h => (h || "").trim());
      const rows = (parsed.data || []) as Record<string, string>[];
      setCsvHeaders(headers);
      setCsvRows(rows);
      if (!rows.length) {
        setCsvErrors(["CSV không có dữ liệu hàng nào."]); setCsvValid(false);
      } else { validateCsv(headers, rows); }
    } catch { setCsvErrors(["Lỗi đọc CSV."]); setCsvValid(false); }
    // (Value clearing moved to Refresh button to preserve chosen filename display.)
  };
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => setImageFiles(Array.from(e.target.files || []));
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => setAudioFiles(Array.from(e.target.files || []));

  const doUploadCover = async (): Promise<string | undefined> => {
    if (!addCover) return undefined;
    const file = (document.getElementById("cover-file") as HTMLInputElement)?.files?.[0];
    if (!file) return undefined;
    setStage("cover");
    await uploadCoverImage({ filmId, episodeNum, file });
    const url = r2Base ? `${r2Base}/items/${filmId}/cover_image/cover.jpg` : `/items/${filmId}/cover_image/cover.jpg`;
    setCoverUrl(url); setCoverDone(1);
    // Removed early apiUpdateFilmMeta call (film may not exist yet). Cover URL will be applied via import filmMeta.
    toast.success("Cover uploaded");
    return url;
  };
  const doUploadEpisodeCover = async () => {
    if (!addEpCover) return;
    const file = (document.getElementById("ep-cover-file") as HTMLInputElement)?.files?.[0];
    if (!file) return;
    setStage("ep_cover");
    const key = await uploadEpisodeCoverImage({ filmId, episodeNum, file });
    setEpCoverDone(1);
    try {
      await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, cover_key: key });
      toast.success("Episode cover uploaded");
    } catch (e) {
      console.error("Episode cover meta update failed", e);
      toast.error("Không cập nhật được episode cover meta (có thể do schema cũ)");
    }
  };
  const doUploadEpisodeFull = async () => {
    const aFile = (document.getElementById("ep-full-audio") as HTMLInputElement)?.files?.[0];
    const vFile = (document.getElementById("ep-full-video") as HTMLInputElement)?.files?.[0];
    if (addEpAudio && aFile) {
      setStage("ep_full_audio");
      const key = await uploadEpisodeFullMedia({ filmId, episodeNum, type: "audio", file: aFile });
      setEpFullAudioDone(1);
      try {
        await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, full_audio_key: key });
      } catch (e) {
        console.error("Episode full audio meta update failed", e);
        toast.error("Không cập nhật được full audio meta tập (schema?)");
      }
    }
    if (addEpVideo && vFile) {
      setStage("ep_full_video");
      setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(vFile.size);
      const key = await uploadEpisodeFullMedia({ filmId, episodeNum, type: "video", file: vFile, onProgress: (done, total) => { setEpFullVideoBytesDone(done); setEpFullVideoBytesTotal(total); } });
      setEpFullVideoDone(1);
      try {
        await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, full_video_key: key });
      } catch (e) {
        console.error("Episode full video meta update failed", e);
        toast.error("Không cập nhật được full video meta tập (schema?)");
      }
    }
  };
  const doUploadMedia = async (type: MediaType, files: File[], signal?: AbortSignal) => {
    if (!files.length) return;
    setStage(type === "image" ? "images" : "audio");
    // const started = Date.now();
    // Reset visible totals to the selected file count; will be corrected by callback's total
    if (type === "image") { setImagesTotal(files.length); setImagesDone(0); } else { setAudioTotal(files.length); setAudioDone(0); }
    await uploadMediaBatch({ filmId, episodeNum, type, files, padDigits, startIndex, inferFromFilenames: infer, signal }, (done, total) => {
      if (type === "image") { setImagesDone(done); setImagesTotal(total); } else { setAudioDone(done); setAudioTotal(total); }
    });
    if (!(signal && signal.aborted)) {
      toast.success(type === "image" ? "Images uploaded" : "Audio uploaded");
    }
  };

  const onCreateAll = async () => {
    if (!user) { toast.error("Sign in required"); return; }
    if (!allowedEmails.includes(user.email || "")) { toast.error("Admin email required"); return; }
    if (requireKey && adminKey !== pass) { toast.error("Admin Key required"); return; }
    if (!filmId) { toast.error("Please enter Content Slug"); return; }
    if (!slugChecked || !slugAvailable) { toast.error("Cần kiểm tra slug trước"); return; }
    try {
      setBusy(true); setStage("starting");
      cancelRequestedRef.current = false;
      uploadAbortRef.current = new AbortController();
      // Reset rollback tracking
      createdFilmRef.current = null;
      createdEpisodeNumRef.current = null;
      importSucceededRef.current = false;
      setCoverDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      // 1. Upload cover for content (if any)
      const uploadedCoverUrl = await doUploadCover().catch(() => undefined);
      // 2. Upload card media (images/audio) for cards (these do not depend on episode row)
      await Promise.all([
        doUploadMedia("image", imageFiles, uploadAbortRef.current!.signal),
        doUploadMedia("audio", audioFiles, uploadAbortRef.current!.signal)
      ]);
      if (cancelRequestedRef.current || uploadAbortRef.current?.signal.aborted) throw new Error("User cancelled");
      // 3. Import CSV to create episode 1 (must be before episode-level media upload)
      if (!csvText) { toast.error("Please select a CSV for cards"); setBusy(false); return; }
      setStage("import");
      const filmMeta: ImportFilmMeta = {
        title,
        description,
        cover_url: uploadedCoverUrl ?? coverUrl ?? "",
        language: mainLanguage,
        available_subs: [],
        episodes: 1,
        total_episodes: 1,
        episode_title: episodeTitle || undefined,
        ...(contentType ? { type: contentType } : {}),
        ...(releaseYear !== "" ? { release_year: releaseYear } : {}),
        is_original: isOriginal,
      };
      // derive cardIds from filenames when infer enabled
      let cardIds: string[] | undefined = undefined;
      if (infer) {
        const all = [...imageFiles, ...audioFiles];
        const set = new Set<string>();
        all.forEach(f => { const m = f.name.match(/(\d+)(?=\.[^.]+$)/); if (m) { const raw = m[1]; const id = raw.length >= padDigits ? raw : raw.padStart(padDigits, "0"); set.add(id); } });
        if (set.size) { cardIds = Array.from(set).sort((a,b)=>parseInt(a,10)-parseInt(b,10)); }
      }
      try {
        await importFilmFromCsv({
          filmSlug: filmId,
          episodeNum,
          filmMeta,
          csvText,
          mode: replaceMode ? "replace" : "append",
          cardStartIndex: startIndex,
          cardPadDigits: padDigits,
          cardIds,
          overrideMainSubtitleHeader: mainLangHeaderOverride || undefined,
        }, () => {});
        // Mark as created for rollback tracking
        createdFilmRef.current = filmId;
        createdEpisodeNumRef.current = episodeNum;
        importSucceededRef.current = true;
        setImportDone(true);
        toast.success("Import completed");
      } catch (importErr) {
        console.error("❌ Import failed:", importErr);
        toast.error("Import failed: " + (importErr as Error).message);
        throw importErr; // Re-throw to stop the process
      }
      // 4. Upload episode-level media (cover, full audio, full video) AFTER episode row exists
      await doUploadEpisodeCover().catch(() => {});
      if (cancelRequestedRef.current) throw new Error("User cancelled");
      await doUploadEpisodeFull().catch(() => {});
      if (cancelRequestedRef.current) throw new Error("User cancelled");
      // 5. Calculate stats immediately after import
      setStage("calculating_stats");
      try {
        const res = await apiCalculateStats({ filmSlug: filmId, episodeNum });
        if ("error" in res) {
          toast.error("Tính thống kê thất bại (có thể do schema cũ)");
        } else {
          setStatsDone(true);
        }
      } catch {
        // ignore but surface a toast
        toast.error("Không tính được thống kê cho nội dung này");
      }
      setStage("done"); toast.success("Content + Episode 1 created successfully");
      // Post-success: refresh global main-language options and notify Search to refresh
      try {
        const langs = await getAvailableMainLanguages();
        const current = (globalPreferences.main_language) || 'en';
        if (!langs.includes(current) && langs.length) {
          await setGlobalMainLanguage(langs[0]);
        }
      } catch { /* ignore */ }
      try { invalidateGlobalCardsCache(); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('content-updated')); } catch { /* ignore */ }
      // Sau khi upload xong, gọi lại apiGetFilm để cập nhật trạng thái slug
      const film = await apiGetFilm(filmId).catch(() => null);
      setSlugChecked(true);
      setSlugAvailable(film ? false : true);
    } catch (e) {
      const msg = (e as Error).message || "";
      const wasCancelled = /cancelled/i.test(msg);
      if (wasCancelled) {
        toast("Đã hủy tiến trình upload/import");
      } else {
        toast.error("Lỗi: " + (e as Error).message);
      }
      // Auto-rollback on error or cancel if import succeeded
      if (importSucceededRef.current && createdFilmRef.current) {
        toast.loading("Đang rollback tự động...", { id: "rollback-auto" });
        try {
          // Delete the film directly (cascades ALL episodes/cards/media)
          // Skip apiDeleteEpisode to avoid "cannot delete first episode" error
          const filmRes = await apiDeleteItem(createdFilmRef.current);
          if ("error" in filmRes) {
            console.error("Rollback film failed:", filmRes.error);
            toast.error("Rollback film thất bại: " + filmRes.error, { id: "rollback-auto" });
          } else {
            console.log("✅ Rollback: deleted film", filmRes.deleted, "episodes:", filmRes.episodes_deleted, "cards:", filmRes.cards_deleted, "media:", filmRes.media_deleted);
            toast.success(wasCancelled ? "Đã hủy và rollback" : "Đã rollback do lỗi", { id: "rollback-auto" });
          }
          // Reset slug check state so user can retry
          setSlugChecked(false);
          setSlugAvailable(null);
        } catch (rollbackErr) {
          console.error("Rollback error:", rollbackErr);
          toast.error("Rollback thất bại: " + (rollbackErr as Error).message, { id: "rollback-auto" });
        }
      }
    } finally { setBusy(false); }
  };

  const onCancelAll = async () => {
    // Confirm manual cancel if import already succeeded
    if (importSucceededRef.current && createdFilmRef.current) {
      const confirmed = window.confirm("Import đã hoàn thành. Bạn có muốn ROLLBACK (xóa film/episode đã tạo) không?\n\nChọn OK = Rollback\nChọn Cancel = Chỉ dừng upload");
      if (confirmed) {
        toast.loading("Đang rollback...", { id: "rollback-manual" });
        try {
          // Delete film directly (cascades ALL episodes/cards/media)
          // Skip apiDeleteEpisode to avoid "cannot delete first episode" error
          const filmRes = await apiDeleteItem(createdFilmRef.current);
          if ("error" in filmRes) {
            toast.error("Rollback film thất bại: " + filmRes.error, { id: "rollback-manual" });
          } else {
            console.log("✅ Manual rollback: deleted film", filmRes.deleted, "episodes:", filmRes.episodes_deleted, "cards:", filmRes.cards_deleted, "media:", filmRes.media_deleted);
            toast.success("Đã rollback thành công", { id: "rollback-manual" });
          }
          // Reset slug check
          setSlugChecked(false);
          setSlugAvailable(null);
        } catch (err) {
          console.error("Manual rollback error:", err);
          toast.error("Rollback thất bại: " + (err as Error).message, { id: "rollback-manual" });
        }
      }
    }
    // Cancel ongoing uploads regardless
    cancelRequestedRef.current = true;
    try { uploadAbortRef.current?.abort(); } catch (err) { void err; }
    setStage("idle");
    // reset progress counters to pre-run state
    setCoverDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
    setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
    setImagesDone(0); setAudioDone(0); setImagesTotal(0); setAudioTotal(0);
    setImportDone(false); setStatsDone(false);
    importSucceededRef.current = false;
    createdFilmRef.current = null;
    createdEpisodeNumRef.current = null;
    setBusy(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="admin-section-header">
        <h2 className="admin-title">Create New Content (Episode 1)</h2>
        <button className="admin-btn secondary" onClick={() => window.location.href = '/admin/content'}>← Back</button>
      </div>

      {/* Auth */}
      {user ? (
        <div className="admin-panel space-y-2">
          <div className="text-sm">Signed in as <span className="text-gray-300">{user.email}</span></div>
          <div className="text-sm">Admin emails allowed: <span className="text-gray-400">{(import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "").toString()}</span></div>
          {requireKey && (
            <div className="text-xs text-gray-400">Admin Key required — set it once in the SideNav.</div>
          )}
          <div className="text-sm">Access: {isAdmin ? <span className="text-green-400">granted</span> : <span className="text-red-400">denied</span>}</div>
        </div>
      ) : (
        <div className="admin-panel">
          <div className="text-sm mb-2">You must sign in to continue.</div>
          <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>
        </div>
      )}

      {/* Quick Guide */}
      {isAdmin && (
        <div className="admin-panel space-y-3">
          <div className="text-sm font-semibold">Hướng dẫn nhanh</div>
            <div className="admin-subpanel text-xs space-y-3">
            <div className="text-gray-300 font-semibold">A) Các trường nhập</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li><span className="text-gray-300">Content Slug</span>: slug không dấu (vd. <code>cinderella</code>). Dùng nút Check để xác thực không trùng.</li>
              <li><span className="text-gray-300">Main Language</span>: ngôn ngữ chính.</li>
              <li><span className="text-gray-300">Title</span>, <span className="text-gray-300">Description</span> mô tả.</li>
              <li><span className="text-gray-300">Episode 1</span>: tự động tạo, không chỉnh sửa số tập ở đây.</li>
              <li><span className="text-gray-300">Episode Title</span> (tuỳ chọn).</li>
              <li><span className="text-gray-300">Type</span>: cleaned text for the card (should be the main-language snippet used for study; remove audio/pronunciation cues like <code>[music]</code> or <code>(sfx)</code>). Not used to classify content type.</li>
              <li><span className="text-gray-300">Release Year</span> (tuỳ chọn) helps categorize.</li>
              <li><span className="text-gray-300">Media tuỳ chọn</span>: Cover (content + episode), Full Audio/Video cho Episode.</li>
              <li><span className="text-gray-300">Card Media Files</span>: ảnh (.jpg) & audio (.mp3) cho cards (bắt buộc).</li>
            </ul>
            <div className="text-gray-300 font-semibold">B) CSV cần</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Cột bắt buộc: <code>start,end</code>.</li>
              <li>Phải có cột phụ đề cho Main Language ({mainLanguage}).</li>
              <li><code>type</code> tùy chọn; <code>sentence</code> tự động lấy từ phụ đề của Main Language.</li>
              <li>Hỗ trợ đa ngôn ngữ: en, vi, zh, zh_trad, yue, ja, ko, id, th, ms.</li>
              <li><code>difficulty_score</code> (0-100) + alias; framework <code>cefr</code>/<code>jlpt</code>/<code>hsk</code> tuỳ chọn.</li>
              <li>Infer IDs: lấy số cuối tên file làm card id; nếu tắt dùng Pad + Start Index.</li>
            </ul>
            <div className="text-[10px] text-gray-500 italic space-y-1">
              <div>Ví dụ tối thiểu: <code>start,end,type,en</code></div>
              <div>Đảm bảo thời gian tăng dần để hiển thị ổn định.</div>
            </div>
          </div>
        </div>
      )}

      {/* Content meta */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Content Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Content Slug</label>
            <div className="relative w-full">
              <input
                className="admin-input pr-9"
                value={filmId}
                onChange={e => setFilmId(e.target.value.replace(/\s+/g,'_').toLowerCase())}
                placeholder="cinderella"
              />
              {(slugChecking || slugChecked) && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-pink-400 group">
                  {slugChecking && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                  {!slugChecking && slugChecked && slugAvailable === true && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {!slugChecking && slugChecked && slugAvailable === false && <XCircle className="w-4 h-4 text-red-400" />}
                  {/* Pretty tooltip */}
                  <div className="absolute right-0 mt-2 translate-y-2 hidden group-hover:block whitespace-nowrap px-2 py-1 text-[11px] leading-tight rounded border shadow-lg bg-[#241530] border-pink-500/50 text-pink-100">
                    {slugChecking ? 'Đang kiểm tra…' : (slugAvailable ? 'Slug khả dụng - có thể tạo.' : 'Slug đã tồn tại - chọn slug khác.')}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Main Language</label>
            <div className="relative w-full" ref={langDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setLangOpen(v => !v); }}>
                <span className="inline-flex items-center gap-2">
                  {/* Use emoji flags for 100% reliability across all languages */}
                  <FlagDisplay lang={mainLanguage} />
                  <span>{langLabel(mainLanguage)} ({mainLanguage})</span>
                </span>
                <span className="text-gray-400">▼</span>
              </button>
              {langOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
                  <div className="sticky top-0 z-10 bg-[#241530] p-2 border-b border-pink-500/50">
                    <input
                      autoFocus
                      value={langQuery}
                      onChange={(e) => setLangQuery(e.target.value)}
                      placeholder="Search language..."
                      className="admin-input text-xs py-1 px-2"
                    />
                  </div>
                  {FILTERED_LANG_OPTIONS.map(l => (
                    <div key={l} className="admin-dropdown-item" onClick={() => { setMainLanguage(l); setLangOpen(false); setLangQuery(""); }}>
                      <FlagDisplay lang={l} />
                      <span className="text-sm">{langLabel(l)} ({l})</span>
                    </div>
                  ))}
                  {FILTERED_LANG_OPTIONS.length === 0 && (
                    <div className="px-3 py-2 text-xs text-pink-200/70">No languages match “{langQuery}”.</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Title</label>
            <input className="admin-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" />
          </div>
                    <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Release Year</label>
            <div className="relative w-full" ref={yearDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setYearOpen(v => !v); }}>
                <span>{releaseYear !== "" ? releaseYear : "(optional)"}</span>
                <span className="text-gray-400">▼</span>
              </button>
              {yearOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
                  {(() => { const yrs: number[] = []; const current = new Date().getFullYear(); for (let y = current; y >= 1950; y--) yrs.push(y); return yrs; })().map(y => (
                    <div key={y} className="admin-dropdown-item" onClick={() => { setReleaseYear(y); setYearOpen(false); }}><span>{y}</span></div>
                  ))}
                  <div className="admin-dropdown-clear" onClick={() => { setReleaseYear(""); setYearOpen(false); }}>Clear</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Type</label>
            <div className="relative w-full" ref={typeDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setTypeOpen(v => !v); }}>
                <span className="inline-flex items-center gap-2">
                  {contentType === "movie" && <Film className="w-4 h-4" />}
                  {contentType === "series" && <Clapperboard className="w-4 h-4" />}
                  {contentType === "book" && <BookIcon className="w-4 h-4" />}
                  {contentType === "audio" && <AudioLines className="w-4 h-4" />}
                  <span>{contentType ? CONTENT_TYPE_LABELS[contentType] : "(required)"}</span>
                </span>
                <span className="text-gray-400">▼</span>
              </button>
              {typeOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel">
                  {CONTENT_TYPES.map(t => (
                    <div key={t} className="admin-dropdown-item text-sm" onClick={() => { setContentType(t); setTypeOpen(false); }}>
                      {t === "movie" && <Film className="w-4 h-4" />}
                      {t === "series" && <Clapperboard className="w-4 h-4" />}
                      {t === "book" && <BookIcon className="w-4 h-4" />}
                      {t === "audio" && <AudioLines className="w-4 h-4" />}
                      <span>{CONTENT_TYPE_LABELS[t]}</span>
                    </div>
                  ))}
                  <div className="admin-dropdown-clear" onClick={() => { setContentType(""); setTypeOpen(false); }}>Clear</div>
                </div>
              )}
            </div>
          </div>
          {/* Right column partner for Type: Original Version toggle */}
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Original Version</label>
            <div className="flex items-center gap-3">
              <input id="chk-original" type="checkbox" checked={isOriginal} onChange={e => setIsOriginal(e.target.checked)} />
              <label htmlFor="chk-original" className="text-xs text-gray-300 cursor-pointer">This is the original version (source language).</label>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-1">Description</label>
          <textarea className="admin-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Existing Episodes panel removed for E1-only creation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-cover" type="checkbox" checked={addCover} onChange={e => setAddCover(e.target.checked)} />
              <label htmlFor="chk-cover" className="cursor-pointer">Add Cover (jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa chính (.jpg) lưu tại items/&lt;slug&gt;/cover_image/cover.jpg</span>
              </span>
            </div>
            {addCover && (
              <>
                <input id="cover-file" type="file" accept="image/jpeg" onChange={e => setHasCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/cover_image/cover.jpg</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Episode 1 meta (number locked) */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Episode 1</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm flex items-center gap-1">
              <span>Episode Num</span>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
                  This page only creates Episode 1. To add more episodes, use the Add Episode page. The episode number is locked here.
                </span>
              </span>
            </label>
            <input type="number" min={1} className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none" value={1} disabled readOnly aria-disabled="true" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Title</label>
            <input className="admin-input" value={episodeTitle} onChange={e => setEpisodeTitle(e.target.value)} placeholder="Optional episode title" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-cover" type="checkbox" checked={addEpCover} onChange={e => setAddEpCover(e.target.checked)} />
              <label htmlFor="chk-ep-cover" className="cursor-pointer">Add Cover (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa cho tập lưu tại items/&lt;slug&gt;/episodes/&lt;slug&gt;_&lt;num&gt;/cover/cover.jpg</span>
              </span>
            </div>
            {addEpCover && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg" onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/cover/cover.jpg</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-audio" type="checkbox" checked={addEpAudio} onChange={e => setAddEpAudio(e.target.checked)} />
              <label htmlFor="chk-ep-audio" className="cursor-pointer">Add Full Audio (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Upload full audio (.mp3) cho tập.</span>
              </span>
            </div>
            {addEpAudio && (
              <>
                <input
                  id="ep-full-audio"
                  type="file"
                  accept="audio/mpeg,audio/wav"
                  onChange={e => {
                    const file = (e.target as HTMLInputElement).files?.[0] || null;
                    setHasEpAudioFile(!!file);
                    if (file) {
                      const t = (file.type || '').toLowerCase();
                      setEpFullAudioExt((/wav$/.test(t) || t === 'audio/wav' || t === 'audio/x-wav') ? 'wav' : 'mp3');
                    } else {
                      setEpFullAudioExt('mp3');
                    }
                  }}
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full"
                />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/audio.{epFullAudioExt}</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-video" type="checkbox" checked={addEpVideo} onChange={e => setAddEpVideo(e.target.checked)} />
              <label htmlFor="chk-ep-video" className="cursor-pointer">Add Full Video (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Upload full video (.mp4) cho tập.</span>
              </span>
            </div>
            {addEpVideo && (
              <>
                <input id="ep-full-video" type="file" accept="video/mp4" onChange={e => setHasEpVideoFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/video.mp4</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CSV */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Cards CSV</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onPickCsv} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500" />
          <button type="button" title="Refresh / Re-import CSV" onClick={() => { if (csvRef.current) { csvRef.current.value = ""; csvRef.current.click(); } }} className="admin-btn secondary flex items-center gap-1">
            <RefreshCcw className="w-4 h-4" />
            <span className="text-xs">Refresh</span>
          </button>
          <button type="button" className="admin-btn" onClick={() => {
            const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
            const headers = ["start","end",mainCanon,"cefr","difficulty_score"]; // type optional
            const sample = [
              ["13.75","24.602","Once upon a time","A2","40"],
              ["24.603","27.209","Her name was Ella.","A2","35"],
            ];
            const csv = [headers.join(","), ...sample.map(r=>r.join(","))].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `template_${mainCanon}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }}>Download template</button>
        </div>
        {csvFileName && <div className="text-xs text-gray-500">{csvFileName}</div>}
        {csvValid !== null && (
          <div className={`flex items-start gap-2 text-sm ${csvValid ? "text-green-400" : "text-red-400"}`}>
            {csvValid ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
            <div>{csvValid ? <span>CSV hợp lệ.</span> : <div className="space-y-1"><div>CSV cần chỉnh sửa:</div><ul className="list-disc pl-5 text-xs">{csvErrors.map((er,i)=><li key={i}>{er}</li>)}</ul></div>}</div>
          </div>
        )}
        {csvWarnings.length > 0 && csvValid && (
          <div className="flex items-start gap-2 text-xs text-yellow-400"><AlertTriangle className="w-4 h-4 mt-0.5" /><ul className="list-disc pl-5">{csvWarnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>
        )}
        {csvHeaders.length > 0 && mainLangHeaderOptions.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-300">Main Language column ({langLabel(mainLanguage)}):</label>
            <select
              className="admin-input !py-1 !px-2 max-w-xs"
              value={mainLangHeaderOverride || mainLangHeaderOptions[0]}
              onChange={e => setMainLangHeaderOverride(e.target.value)}
            >
              {mainLangHeaderOptions.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500">Prefers non-CC by default</span>
          </div>
        )}
        {csvHeaders.length > 0 && (
          <div className="overflow-auto border border-gray-700 rounded max-h-[480px]">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-[#1a0f24] z-10">
                <tr>
                  <th className="border border-gray-700 px-2 py-1 text-left">#</th>
                  {csvHeaders.map((h, i) => {
                    const isRequired = requiredOriginals.includes(h);
                    const selectedMainHeader = mainLangHeaderOverride || mainLangHeader;
                    const isMainLang = selectedMainHeader === h;
                    return (
                      <th
                        key={i}
                        className={`border border-gray-700 px-2 py-1 text-left ${isRequired || isMainLang ? 'bg-pink-900/30 font-semibold' : ''}`}
                        title={isRequired ? 'Required' : isMainLang ? 'Main Language' : ''}
                      >
                        {h}
                        {isRequired && <span className="text-red-400 ml-1">*</span>}
                        {isMainLang && <span className="text-amber-400 ml-1">★</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, i) => (
                  <tr key={i} className="hover:bg-pink-900/10">
                    <td className="border border-gray-700 px-2 py-1 text-gray-500">{i + 1}</td>
                    {csvHeaders.map((h, j) => {
                      const val = row[h] || '';
                      const isRequired = requiredOriginals.includes(h);
                      const selectedMainHeader = mainLangHeaderOverride || mainLangHeader;
                      const isMainLang = selectedMainHeader === h;
                      const isEmpty = !val.trim();
                      return (
                        <td
                          key={j}
                          className={`border border-gray-700 px-2 py-1 ${isEmpty && (isRequired || isMainLang) ? 'bg-red-900/20 text-red-300' : 'text-gray-300'}`}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-gray-500 px-2 py-1">
              <span className="text-red-400">*</span> = Required column |{' '}
              <span className="text-amber-400">★</span> = Main Language column
              {ignoredHeaders.length > 0 && (
                <>
                  {' '}| <span className="text-yellow-400">⚠</span> Ignored columns: {ignoredHeaders.join(', ')}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Card Media */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Card Media Files</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Images (.jpg)</div>
            <input type="file" accept="image/jpeg" multiple onChange={onPickImages} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
          </div>
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Audio (.mp3)</div>
            <input type="file" accept="audio/mpeg,audio/wav" multiple onChange={onPickAudio} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
          </div>
          <div className="flex flex-col gap-3 md:col-span-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Pad Digits</label>
                <input type="number" min={1} value={padDigits} onChange={e => setPadDigits(Math.max(1, Number(e.target.value)||1))} className="admin-input disabled:opacity-50" disabled={infer} />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Start Index</label>
                <input type="number" min={0} value={startIndex} onChange={e => setStartIndex(Math.max(0, Number(e.target.value)||0))} className="admin-input disabled:opacity-50" disabled={infer} />
              </div>
            </div>
            {infer && <div className="text-xs text-gray-500">Pad Digits & Start Index chỉ dùng khi tắt Infer IDs.</div>}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <input id="infer-ids" type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} />
                <label htmlFor="infer-ids" className="text-sm select-none">Infer IDs</label>
                <span className="relative group inline-flex"><HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" /><span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Lấy số cuối tên file làm Card ID.</span></span>
              </div>
              <div className="flex items-center gap-2 flex-1">
                <input id="replace-cards" type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} />
                <label htmlFor="replace-cards" className="text-sm select-none">Replace existing cards</label>
                <span className="relative group inline-flex"><HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" /><span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-72 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Nếu bật xoá toàn bộ cards + subtitles trước khi thêm mới.</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions + Progress */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          {!user && <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>}
          <button className="admin-btn primary" disabled={busy || !canCreate} onClick={onCreateAll} title={!isAdmin ? "Requires allowed admin email + key" : undefined}>{busy ? "Processing..." : "Create Content"}</button>
          {busy && stage !== 'done' && (
            <button type="button" className="admin-btn danger" onClick={onCancelAll} title="Cancel current upload/import">Stop</button>
          )}
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === "done") && (
          <div className="admin-panel text-xs space-y-2">
            {/* Progress items in actual execution order */}
            {/* 1. Cover (optional) */}
            {addCover && hasCoverFile && (
              <ProgressItem label="1. Cover" done={coverDone > 0} pending={stage === "cover" || (busy && coverDone === 0)} />
            )}
            {/* 2. Card Media (images + audio in parallel) */}
            <div className="flex justify-between"><span>2. Images</span><span>{imagesDone}/{imagesTotal}</span></div>
            <div className="flex justify-between"><span>3. Audio</span><span>{audioDone}/{audioTotal}</span></div>
            {/* 3. Import CSV */}
            <div className="flex justify-between">
              <span>4. Import CSV</span>
              <span>{importDone ? "✓" : stage === "import" ? "..." : (imagesDone === imageFiles.length && audioDone === audioFiles.length ? "waiting" : "pending")}</span>
            </div>
            {/* 4. Episode-level optional media (after import) */}
            {addEpCover && hasEpCoverFile && (
              <ProgressItem label="5. Episode Cover" done={epCoverDone > 0} pending={stage === "ep_cover" || (importDone && epCoverDone === 0)} />
            )}
            {addEpAudio && hasEpAudioFile && (
              <ProgressItem label="6. Episode Full Audio" done={epFullAudioDone > 0} pending={stage === "ep_full_audio" || (importDone && epFullAudioDone === 0)} />
            )}
            {addEpVideo && hasEpVideoFile && (
              <div className="flex justify-between">
                <span>7. Episode Full Video</span>
                <span>
                  {epFullVideoDone > 0
                    ? "✓"
                    : stage === "ep_full_video" && epFullVideoBytesTotal > 0
                      ? `${Math.min(100, Math.round((epFullVideoBytesDone / epFullVideoBytesTotal) * 100))}%`
                      : (importDone ? "waiting" : "pending")}
                </span>
              </div>
            )}
            {/* 5. Calculate Stats (final step) */}
            <div className="flex justify-between">
              <span>8. Calculating Stats</span>
              <span>{statsDone ? "✓" : stage === "calculating_stats" ? "..." : (importDone ? "waiting" : "pending")}</span>
            </div>
            {/* Progress bar */}
            {(() => {
              // Calculate total steps (each optional media counts as 1 unit)
              let totalSteps = 0;
              let completedSteps = 0;

              // 1. Cover (optional)
              if (addCover && hasCoverFile) {
                totalSteps++;
                if (coverDone > 0) completedSteps++;
              }

              // 2-3. Card media (images + audio) - use EFFECTIVE totals from uploader (after skips)
              totalSteps += imagesTotal + audioTotal;
              completedSteps += imagesDone + audioDone;

              // 4. Import CSV (required)
              totalSteps++;
              if (importDone) completedSteps++;

              // 5-7. Episode-level media (optional)
              if (addEpCover && hasEpCoverFile) {
                totalSteps++;
                if (epCoverDone > 0) completedSteps++;
              }
              if (addEpAudio && hasEpAudioFile) {
                totalSteps++;
                if (epFullAudioDone > 0) completedSteps++;
              }
              if (addEpVideo && hasEpVideoFile) {
                totalSteps++;
                if (epFullVideoDone > 0) completedSteps += 1;
                else if (stage === 'ep_full_video' && epFullVideoBytesTotal > 0) {
                  completedSteps += Math.max(0, Math.min(1, epFullVideoBytesDone / epFullVideoBytesTotal));
                }
              }

              // 8. Calculate Stats (required)
              totalSteps++;
              if (statsDone) completedSteps++;

              // Prevent showing 100% until ALL steps are completed
              let pct: number;
              if (totalSteps === 0) pct = 0;
              else if (completedSteps === totalSteps) pct = 100;
              else pct = Math.min(99, Math.floor((completedSteps / totalSteps) * 100));

              return (<div className="mt-2"><ProgressBar percent={pct} /></div>);
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressItem({ label, done, pending }: { label: string; done: boolean; pending: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{done ? "✓" : pending ? "..." : "skip"}</span>
    </div>
  );
}
