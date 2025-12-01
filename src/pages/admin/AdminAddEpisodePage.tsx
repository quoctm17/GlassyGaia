import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { apiGetFilm, apiListEpisodes, apiUpdateEpisodeMeta, apiCalculateStats, apiDeleteEpisode } from '../../services/cfApi';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia, uploadMediaBatch } from '../../services/storageUpload';
import type { MediaType } from '../../services/storageUpload';
import { canonicalizeLangCode, langLabel, countryCodeForLang, expandCanonicalToAliases } from '../../utils/lang';
import ProgressBar from '../../components/ProgressBar';
import { Loader2, CheckCircle, RefreshCcw, AlertTriangle } from 'lucide-react';
import CsvPreviewPanel from '../../components/CsvPreviewPanel';

// Page to add a new Episode (>=2) to an existing Content Item
export default function AdminAddEpisodePage() {
  const { contentSlug } = useParams();
  const navigate = useNavigate();
  const { user, adminKey } = useUser();
  const allowedEmails = useMemo(() => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean), []);
  const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
  const requireKey = !!pass;
  const isAdmin = !!user && allowedEmails.includes(user.email || '') && (!requireKey || adminKey === pass);

  // Existing film meta
  const [filmMainLang, setFilmMainLang] = useState('en');
  const [filmTitle, setFilmTitle] = useState('');
  const [filmDescription, setFilmDescription] = useState('');
  const [existingEpisodes, setExistingEpisodes] = useState<Array<{ episode_number: number; title: string | null }>>([]);
  const existingEpisodeNums = useMemo(() => new Set(existingEpisodes.map(e => e.episode_number)), [existingEpisodes]);

  // Episode form state
  const [episodeNum, setEpisodeNum] = useState<number>(2); // default next
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDescription, setEpisodeDescription] = useState('');
  const [addEpCover, setAddEpCover] = useState(false);
  const [addEpAudio, setAddEpAudio] = useState(false);
  const [addEpVideo, setAddEpVideo] = useState(false);

  // CSV & cards media
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  // (Unused) warnings placeholder removed to satisfy lint
  const [csvValid, setCsvValid] = useState<boolean|null>(null);
  // Allow selecting which CSV header to treat as Main Language subtitle (override auto-detected)
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string | null>(null);
  // Reserved column confirmation state (for ambiguous columns like 'id' which could be Indonesian)
  const [confirmedAsLanguage, setConfirmedAsLanguage] = useState<Set<string>>(new Set());
  const csvRef = useRef<HTMLInputElement|null>(null);

  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [epNumStatus, setEpNumStatus] = useState<'idle' | 'checking' | 'new' | 'duplicate'>('idle');
  // File presence flags for selected episode-level uploads
  const [hasEpCoverFile, setHasEpCoverFile] = useState(false);
  const [hasEpAudioFile, setHasEpAudioFile] = useState(false);
  const [hasEpVideoFile, setHasEpVideoFile] = useState(false);

  // Progress
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('idle');
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [epFullAudioDone, setEpFullAudioDone] = useState(0);
  const [epFullVideoDone, setEpFullVideoDone] = useState(0);
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [audioTotal, setAudioTotal] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [statsDone, setStatsDone] = useState(false);
  const [progress, setProgress] = useState(0); // percent progress
  const [epFullVideoBytesDone, setEpFullVideoBytesDone] = useState(0);
  const [epFullVideoBytesTotal, setEpFullVideoBytesTotal] = useState(0);
  // Cancel / abort controls
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);
  // Rollback tracking: track episode creation for cleanup on error/cancel
  const importSucceededRef = useRef<boolean>(false);
  // Confirmation modal for cancel
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Deletion/rollback progress
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);


  // Load film + existing episodes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const slug = (contentSlug || '').trim();
      if (!slug) return;
      try {
        const film = await apiGetFilm(slug);
        if (!cancelled && film) {
          setFilmMainLang(film.main_language || 'en');
          setFilmTitle(film.title || slug);
          setFilmDescription(film.description || '');
        }
  } catch { /* ignore film fetch errors */ }
      try {
        const eps = await apiListEpisodes((contentSlug || '').trim());
        if (!cancelled) {
          setExistingEpisodes(eps.map(r => ({ episode_number: r.episode_number, title: r.title })));
          const next = eps.length ? Math.max(...eps.map(e => e.episode_number)) + 1 : 2;
          setEpisodeNum(next);
          // Initialize status for episode number
          const isDup = new Set(eps.map(e => e.episode_number)).has(next);
          setEpNumStatus(isDup ? 'duplicate' : 'new');
        }
  } catch { /* ignore episodes list errors */ }
    }
    load();
    return () => { cancelled = true; };
  }, [contentSlug]);

  // Re-evaluate status if episodes list changes (and not actively checking)
  useEffect(() => {
    if (epNumStatus !== 'checking') {
      const target: 'new' | 'duplicate' = existingEpisodeNums.has(episodeNum) ? 'duplicate' : 'new';
      if (epNumStatus !== target) setEpNumStatus(target);
    }
  }, [existingEpisodeNums, episodeNum, epNumStatus]);

  // CSV helpers
  // Helper to find header for a given language (strict variant matching)
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
  const mainLangHeader = useMemo(() => findHeaderForLang(csvHeaders, filmMainLang), [csvHeaders, filmMainLang]);
  
  // Derive lists for unrecognized and reserved columns (EXACT COPY from AdminContentIngestPage)
  const { unrecognizedHeaders, reservedHeaders, ambiguousHeaders, recognizedSubtitleHeaders } = useMemo(() => {
    if (!csvHeaders.length) return { unrecognizedHeaders: [] as string[], reservedHeaders: [] as string[], ambiguousHeaders: [] as string[], recognizedSubtitleHeaders: new Set<string>() };
    
    // Same reserved columns as validateCsv in AdminContentIngestPage
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
    
    const langAliases: Record<string, string> = {
      english: "en", eng: "en", vietnamese: "vi", vn: "vi",
      chinese: "zh", "chinese simplified": "zh", chinese_simplified: "zh", zh: "zh", cn: "zh", "zh-cn": "zh", zh_cn: "zh", "zh-hans": "zh", zh_hans: "zh", "zh-hans-cn": "zh", zh_hans_cn: "zh", "zh-simplified": "zh", zh_simplified: "zh",
      "chinese traditional": "zh_trad", "traditional chinese": "zh_trad", traditional_chinese: "zh_trad", zh_trad: "zh_trad", "zh-tw": "zh_trad", zh_tw: "zh_trad", "zh-hant": "zh_trad", zh_hant: "zh_trad", "zh-hk": "zh_trad", zh_hk: "zh_trad", "zh-mo": "zh_trad", zh_mo: "zh_trad", "zh-hant-tw": "zh_trad", zh_hant_tw: "zh_trad", "zh-hant-hk": "zh_trad", zh_hant_hk: "zh_trad", tw: "zh_trad",
      japanese: "ja", ja: "ja", jp: "ja", korean: "ko", ko: "ko", kr: "ko",
      indonesian: "id", id: "id", "in": "id", thai: "th", th: "th", malay: "ms", ms: "ms", my: "ms",
      cantonese: "yue", yue: "yue", "zh-yue": "yue", zh_yue: "yue",
      arabic: "ar", ar: "ar", basque: "eu", eu: "eu", bengali: "bn", bn: "bn", catalan: "ca", ca: "ca", croatian: "hr", hr: "hr", czech: "cs", cs: "cs", danish: "da", da: "da", dutch: "nl", nl: "nl",
      filipino: "fil", fil: "fil", tagalog: "fil", tl: "fil", finnish: "fi", fi: "fi",
      french: "fr", fr: "fr", "french canadian": "fr_ca", "french (canada)": "fr_ca", fr_ca: "fr_ca", frcan: "fr_ca",
      galician: "gl", gl: "gl", german: "de", de: "de", greek: "el", el: "el", hebrew: "he", he: "he", iw: "he", hindi: "hi", hi: "hi", hungarian: "hu", hu: "hu", icelandic: "is", is: "is", italian: "it", it: "it", malayalam: "ml", ml: "ml", norwegian: "no", no: "no", nb: "nb", "norwegian bokmal": "nb", "norwegian bokmål": "nb", bokmal: "nb", bokmål: "nb", polish: "pl", pl: "pl",
      portuguese: "pt_pt", pt: "pt_pt", pt_pt: "pt_pt", ptpt: "pt_pt", "portuguese (portugal)": "pt_pt",
      "portuguese (brazil)": "pt_br", pt_br: "pt_br", ptbr: "pt_br", brazilian_portuguese: "pt_br",
      portugese: "pt_pt", "portugese (portugal)": "pt_pt", "portugese (brazil)": "pt_br",
      romanian: "ro", ro: "ro", russian: "ru", ru: "ru",
      spanish: "es_es", es: "es_es", es_es: "es_es", "spanish (spain)": "es_es",
      "spanish (latin america)": "es_la", es_la: "es_la", latam_spanish: "es_la",
      swedish: "sv", sv: "sv", tamil: "ta", ta: "ta", telugu: "te", te: "te", turkish: "tr", tr: "tr", ukrainian: "uk", uk: "uk",
      persian: "fa", farsi: "fa", fa: "fa",
      kurdish: "ku", ku: "ku",
      slovenian: "sl", sl: "sl",
      serbian: "sr", sr: "sr",
      bulgarian: "bg", bg: "bg",
      // Northern Sami aliases
      "northern sami": "se", "sami (northern)": "se", "sami": "se", se: "se", sme: "se"
    };
    const supported = new Set(["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","nb","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","se","ta","te","th","tr","uk","vi","fa","ku","sl","sr","bg"]);
    const recognizedSubtitleHeaders = new Set<string>();
    const AMBIGUOUS_COLS = new Set(["id", "in"]); // These could be Indonesian language codes OR reserved columns
    
    // Same generalized language detection as in AdminContentIngestPage
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
      
      // If user confirmed this column is a language, treat it as language
      if (confirmedAsLanguage.has(h)) {
        recognizedSubtitleHeaders.add(h);
        return;
      }
      
      // Skip reserved columns BEFORE language detection (but not ambiguous ones - let user decide)
      if (RESERVED_COLUMNS.has(key) && !AMBIGUOUS_COLS.has(key)) return;
      
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
    const unrecognized: string[] = [];
    const reserved: string[] = [];
    const ambiguous: string[] = [];
    // Reserved columns that appear in CSV should be shown separately (ID/number cols that we actively ignore)
    const displayableReserved = new Set(["id", "card_id", "cardid", "card id", "no", "number", "card_number", "cardnumber", "card number"]);
    for (const h of csvHeaders) {
      const raw = (h || '').trim(); if (!raw) continue;
      const low = raw.toLowerCase();
      if (knownSingles.has(low)) continue;
      
      // If user confirmed this column is a language, don't treat as reserved
      if (confirmedAsLanguage.has(raw)) continue;
      
      // Check if it's an ambiguous column that needs user confirmation
      if (AMBIGUOUS_COLS.has(low) && displayableReserved.has(low)) {
        ambiguous.push(raw);
        continue;
      }
      
      // Check if it's a displayable reserved column (actively ignored)
      if (displayableReserved.has(low)) {
        reserved.push(raw);
        continue;
      }
      // Skip other reserved columns
      if (RESERVED_COLUMNS.has(low)) continue;
      if (recognizedSubtitleHeaders.has(raw)) continue;
      if (isFrameworkDynamic(raw)) continue;
      if (low === 'sentence') continue; // already an error above
      unrecognized.push(raw);
    }
    return { unrecognizedHeaders: unrecognized, reservedHeaders: reserved, ambiguousHeaders: ambiguous, recognizedSubtitleHeaders };
  }, [csvHeaders, confirmedAsLanguage]);
  
  // Candidate headers for main language (support simple variant pairs like es_es/es_la, pt_pt/pt_br)
  const mainLangHeaderOptions = useMemo(() => {
    if (!csvHeaders.length) return [] as string[];
    const canon = canonicalizeLangCode(filmMainLang) || filmMainLang;
    // Gather all alias forms for the canonical code (e.g. ja, jp, japanese)
    // plus any simple variant group pairings (Spanish / Portuguese regional variants).
    const variantGroups: Record<string,string[]> = {
      es_es: ["es_es","es_la"], es_la: ["es_es","es_la"],
      pt_pt: ["pt_pt","pt_br"], pt_br: ["pt_pt","pt_br"],
    };
    const baseAliasList = (variantGroups[canon] || [canon])
      .flatMap(code => (expandCanonicalToAliases(code) || [code]));
    const norm = (s: string) => s.toLowerCase()
      .replace(/\[[^\]]*\]/g,'') // drop bracket qualifiers like [CC]
      .replace(/[_\s-]/g,'')
      .trim();
    const headerClean = csvHeaders.map(h => ({ orig: h, clean: norm(h) }));
    const aliasNorms = new Set(baseAliasList.map(a => norm(a)));
    const candidateSet = new Set<string>();
    // Include every header whose cleaned form matches any alias variant.
    headerClean.forEach(h => { if (aliasNorms.has(h.clean)) candidateSet.add(h.orig); });
    // Ensure auto-detected header present even if it didn't match (edge cases)
    if (mainLangHeader) candidateSet.add(mainLangHeader);
    const candidates = Array.from(candidateSet);
    // Sort: prioritize headers without [CC], then shorter (likely code form), then alphabetical.
    candidates.sort((a, b) => {
      const aCc = /\[cc\]/i.test(a) ? 1 : 0;
      const bCc = /\[cc\]/i.test(b) ? 1 : 0;
      if (aCc !== bCc) return aCc - bCc;
      const aLen = a.length; const bLen = b.length;
      if (aLen !== bLen) return aLen - bLen;
      return a.localeCompare(b);
    });
    return candidates;
  }, [csvHeaders, filmMainLang, mainLangHeader]);
  // Keep override synced when headers change (prefer auto-detected if available)
  useEffect(() => {
    if (!mainLangHeaderOptions.length) { setMainLangHeaderOverride(null); return; }
    if (mainLangHeaderOverride && mainLangHeaderOptions.includes(mainLangHeaderOverride)) return;
    if (mainLangHeader && mainLangHeaderOptions.includes(mainLangHeader)) { setMainLangHeaderOverride(mainLangHeader); return; }
    setMainLangHeaderOverride(mainLangHeaderOptions[0]);
  }, [mainLangHeaderOptions, mainLangHeader, mainLangHeaderOverride]);
  const lowerHeaderMap = useMemo(() => {
    const m: Record<string, string> = {};
    csvHeaders.forEach(h => { m[(h || "").toLowerCase()] = h; });
    return m;
  }, [csvHeaders]);
  const requiredOriginals = useMemo(() => ["start", "end"].map(k => lowerHeaderMap[k]).filter(Boolean) as string[], [lowerHeaderMap]);

  const validateCsv = useCallback((headers: string[], rows: Record<string,string>[]) => {
    const errors: string[] = [];
    const headerMap: Record<string,string> = {};
    headers.forEach(h => { const l=(h||'').toLowerCase(); if(!headerMap[l]) headerMap[l]=h; });
    // Không cho phép cột sentence
    if (headerMap["sentence"]) {
      errors.push("Không được truyền cột 'sentence' trong CSV. Hệ thống sẽ tự động lấy subtitle của Main Language để điền vào.");
    }
    // Updated 2025-11: 'sentence' no longer required (auto-derived from main language subtitle), 'type' optional.
    const required = ['start','end'];
    const missing = required.filter(r => !headerMap[r]);
    if (missing.length) errors.push(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
    
    // Language detection with alias support
    const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang;
    // Use user-selected override if present; otherwise auto-detect
    const foundHeader = mainLangHeaderOverride ? headers.find(h => h === mainLangHeaderOverride) : findHeaderForLang(headers, filmMainLang);
    if (!foundHeader) {
      errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon} (có thể dùng "${mainCanon}" hoặc tên đầy đủ như "English", "Vietnamese", v.v.)`);
    }
    
    let ec=0; const maxErr=50;
    const emptySubtitleRows: number[] = [];
    rows.forEach((row,i)=>{
      required.forEach(k=>{
        const orig=headerMap[k];
        const v=orig? (row[orig]||'').trim() : '';
        if(!v){ errors.push(`Hàng ${i+1}: cột "${k}" trống.`); ec++; }
      });
      // Track empty subtitle cells as non-blocking warning
      if (ec < maxErr) {
        let hasEmptySubtitle = false;
        recognizedSubtitleHeaders.forEach((hdr) => {
          const val = (row[hdr] || "").toString().trim();
          if (!val) { hasEmptySubtitle = true; }
        });
        if (hasEmptySubtitle) {
          emptySubtitleRows.push(i + 1);
        }
      }
      if(ec>=maxErr) return;
    });
    const warnings: string[] = [];
    if (emptySubtitleRows.length > 0) {
      const rowList = emptySubtitleRows.slice(0, 10).join(', ') + (emptySubtitleRows.length > 10 ? '...' : '');
      warnings.push(`${emptySubtitleRows.length} cards có subtitle trống (hàng: ${rowList}). Các cards này sẽ mặc định unavailable.`);
    }
    setCsvErrors(errors);
    setCsvWarnings(warnings);
    setCsvValid(errors.length===0);
  }, [filmMainLang, mainLangHeaderOverride, recognizedSubtitleHeaders]);

  useEffect(()=>{ if(csvHeaders.length && csvRows.length) validateCsv(csvHeaders,csvRows); }, [csvHeaders,csvRows,filmMainLang,mainLangHeaderOverride,validateCsv]);

  // Reset file flags when toggles are turned off
  useEffect(() => { if (!addEpCover) setHasEpCoverFile(false); }, [addEpCover]);
  useEffect(() => { if (!addEpAudio) setHasEpAudioFile(false); }, [addEpAudio]);
  useEffect(() => { if (!addEpVideo) setHasEpVideoFile(false); }, [addEpVideo]);

  // Derived: can create episode (align with Ingest page expectations)
  const canCreate = useMemo(() => {
    const hasUser = !!user;
    const emailOk = hasUser && allowedEmails.includes(user?.email || '');
    const keyOk = !requireKey || adminKey === pass;
    const csvOk = csvValid === true;
    // Require at least some card media like Ingest (both images and audio)
    const cardMediaOk = imageFiles.length > 0 && audioFiles.length > 0;
    const epCoverOk = !addEpCover || hasEpCoverFile;
    const epAudioOk = !addEpAudio || hasEpAudioFile;
    const epVideoOk = !addEpVideo || hasEpVideoFile;
    const optionalUploadsOk = epCoverOk && epAudioOk && epVideoOk;
    return !!(hasUser && emailOk && keyOk && csvOk && cardMediaOk && optionalUploadsOk);
  }, [user, allowedEmails, requireKey, adminKey, pass, csvValid, imageFiles.length, audioFiles.length, addEpCover, addEpAudio, addEpVideo, hasEpCoverFile, hasEpAudioFile, hasEpVideoFile]);

  // Overall progress computation across all tasks (matches AdminContentIngestPage logic)
  useEffect(() => {
    let totalSteps = 0;
    let completedSteps = 0;

    // 1. Card media (images + audio) - use EFFECTIVE totals from uploader (after skips)
    totalSteps += imagesTotal + audioTotal;
    completedSteps += imagesDone + audioDone;

    // 2. Import CSV (required)
    totalSteps++;
    if (importDone) completedSteps++;

    // 3. Episode Cover (optional)
    if (addEpCover && hasEpCoverFile) {
      totalSteps++;
      if (epCoverDone > 0) completedSteps++;
    }

    // 4. Episode Full Audio (optional)
    if (addEpAudio && hasEpAudioFile) {
      totalSteps++;
      if (epFullAudioDone > 0) completedSteps++;
    }

    // 4. Episode Full Video (optional with byte-level progress)
    if (addEpVideo && hasEpVideoFile) {
      totalSteps++;
      if (epFullVideoDone > 0) completedSteps += 1;
      else if (stage === 'ep_full_video' && epFullVideoBytesTotal > 0) {
        completedSteps += Math.max(0, Math.min(1, epFullVideoBytesDone / epFullVideoBytesTotal));
      }
    }

    // 5. Calculate Stats (required)
    totalSteps++;
    if (statsDone) completedSteps++;

    // Prevent showing 100% until ALL steps are completed
    let pct: number;
    if (totalSteps === 0) pct = 0;
    else if (completedSteps === totalSteps) pct = 100;
    else pct = Math.min(99, Math.floor((completedSteps / totalSteps) * 100));

    if (pct !== progress) setProgress(pct);
  }, [
    imagesTotal,
    audioTotal,
    imagesDone,
    audioDone,
    importDone,
    addEpCover,
    addEpAudio,
    addEpVideo,
    hasEpCoverFile,
    hasEpAudioFile,
    hasEpVideoFile,
    epCoverDone,
    epFullAudioDone,
    epFullVideoDone,
    epFullVideoBytesDone,
    epFullVideoBytesTotal,
    statsDone,
    stage,
    progress
  ]);

  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if(!f) return; const text = await f.text(); setCsvText(text); setCsvFileName(f.name);
    // Reset confirmed language columns when new file is loaded
    setConfirmedAsLanguage(new Set());
    try { const parsed = Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:'greedy'}); const headers=(parsed.meta.fields||[]).map(h=>(h||'').trim()); const rows=(parsed.data||[]) as Record<string,string>[]; setCsvHeaders(headers); setCsvRows(rows); if(!rows.length){ setCsvErrors(['CSV không có dữ liệu']); setCsvValid(false);} else validateCsv(headers,rows);} catch { setCsvErrors(['Lỗi đọc CSV']); setCsvValid(false);} }

  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => setImageFiles(Array.from(e.target.files||[]));
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => setAudioFiles(Array.from(e.target.files||[]));

  // Upload helpers
  const doUploadEpisodeCover = async () => {
    if(addEpCover) {
      const file=(document.getElementById('ep-cover-file') as HTMLInputElement)?.files?.[0];
      if(file) {
        setStage('ep_cover'); 
        const key=await uploadEpisodeCoverImage({ filmId: contentSlug!, episodeNum, file }); 
        setEpCoverDone(1);
        try { await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, cover_key: key }); toast.success('Episode cover updated'); } 
        catch { toast.error('Không cập nhật được cover episode'); }
      }
    }
  };
  const doUploadEpisodeFull = async () => {
    const aFile=(document.getElementById('ep-full-audio') as HTMLInputElement)?.files?.[0];
    const vFile=(document.getElementById('ep-full-video') as HTMLInputElement)?.files?.[0];
    if(addEpAudio && aFile){ setStage('ep_full_audio'); const key=await uploadEpisodeFullMedia({ filmId: contentSlug!, episodeNum, type:'audio', file:aFile }); setEpFullAudioDone(1); try{ await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_audio_key: key }); }catch{ toast.error('Audio meta fail'); } }
    if(addEpVideo && vFile){ 
      setStage('ep_full_video'); 
      setEpFullVideoBytesDone(0); 
      setEpFullVideoBytesTotal(vFile.size);
      const key=await uploadEpisodeFullMedia({ filmId: contentSlug!, episodeNum, type:'video', file:vFile, onProgress: (done, total) => { setEpFullVideoBytesDone(done); setEpFullVideoBytesTotal(total); } }); 
      setEpFullVideoDone(1); 
      try{ await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_video_key: key }); }catch{ toast.error('Video meta fail'); } 
    }
  };
  const doUploadMedia = async (type: MediaType, files: File[], signal?: AbortSignal) => {
    if (!files.length) return;
    setStage(type === 'image' ? 'images' : 'audio');
    // Reset visible totals to the selected file count; will be corrected by callback's total
    if (type === 'image') { setImagesTotal(files.length); setImagesDone(0); } 
    else { setAudioTotal(files.length); setAudioDone(0); }
    await uploadMediaBatch({
      filmId: contentSlug!,
      episodeNum,
      type,
      files,
      padDigits,
      startIndex,
      inferFromFilenames: infer,
      signal
    }, (done, total) => {
      if (type === 'image') { setImagesDone(done); setImagesTotal(total); } 
      else { setAudioDone(done); setAudioTotal(total); }
    });
    if (!(signal && signal.aborted)) {
      toast.success(type === 'image' ? 'Images uploaded' : 'Audio uploaded');
    }
  };

  const onCreateEpisode = async () => {
    if(!user){ toast.error('Sign in required'); return; }
    if(!isAdmin){ toast.error('Admin access required'); return; }
    if(!contentSlug){ toast.error('Missing content slug'); return; }
    try {
      setBusy(true); setStage('starting');
      cancelRequestedRef.current = false;
      uploadAbortRef.current = new AbortController();
      importSucceededRef.current = false;
      setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0); setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      await Promise.all([
        doUploadMedia('image', imageFiles, uploadAbortRef.current!.signal),
        doUploadMedia('audio', audioFiles, uploadAbortRef.current!.signal)
      ]);
      if (cancelRequestedRef.current || uploadAbortRef.current?.signal.aborted) throw new Error('User cancelled');
      if(!csvText){ toast.error('CSV required'); return; }
      setStage('import');
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      const totalEpisodesDerived = existingEpisodeNums.has(episodeNum) ? existingEpisodes.length : existingEpisodes.length + 1;
      const filmMeta: ImportFilmMeta = {
        title: filmTitle,
        description: filmDescription,
        language: filmMainLang,
        available_subs: [],
        total_episodes: totalEpisodesDerived,
        episodes: 1,
        episode_title: episodeTitle || undefined,
        episode_description: episodeDescription || undefined,
      };
      let cardIds: string[]|undefined = undefined;
      if(infer){ const all=[...imageFiles, ...audioFiles]; const set=new Set<string>(); all.forEach(f=>{ const m=f.name.match(/(\d+)(?=\.[^.]+$)/); if(m){ const raw=m[1]; const id= raw.length>=padDigits? raw: raw.padStart(padDigits,'0'); set.add(id);} }); if(set.size){ cardIds = Array.from(set).sort((a,b)=> parseInt(a)-parseInt(b)); } }
      try {
        // Build confirmed ambiguous language header map (e.g., 'id'/'in' → Indonesian)
        const confirmedMap: Record<string, string> = {};
        confirmedAsLanguage.forEach((hdr) => {
          const low = hdr.trim().toLowerCase();
          if (low === 'id' || low === 'in') confirmedMap['id'] = hdr;
        });
        await importFilmFromCsv({ filmSlug: contentSlug!, episodeNum, filmMeta, csvText, mode: replaceMode? 'replace':'append', cardStartIndex: startIndex, cardPadDigits: padDigits, cardIds, overrideMainSubtitleHeader: mainLangHeaderOverride || undefined, confirmedLanguageHeaders: Object.keys(confirmedMap).length ? confirmedMap : undefined }, () => {});
        importSucceededRef.current = true;
        setImportDone(true);
        toast.success('Import completed');
      } catch (importErr) {
        console.error('❌ Import failed:', importErr);
        toast.error('Import failed: ' + (importErr as Error).message);
        throw importErr;
      }
      // Upload episode-level media AFTER episode row exists
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      await doUploadEpisodeCover().catch(() => {});
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      await doUploadEpisodeFull().catch(() => {});
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      // Calculate stats immediately after import
      setStage('calculating_stats');
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      try {
        const res = await apiCalculateStats({ filmSlug: contentSlug!, episodeNum });
        if ("error" in res) {
          toast.error("Tính thống kê thất bại (có thể do schema cũ)");
        } else {
          setStatsDone(true);
        }
      } catch {
        toast.error("Không tính được thống kê cho episode này");
      }
      setStage('done'); toast.success('Episode imported successfully');
      // Refresh episodes so current number reflects duplicate status
      try {
        const eps = await apiListEpisodes((contentSlug || '').trim());
        setExistingEpisodes(eps.map(r => ({ episode_number: r.episode_number, title: r.title })));
      } catch { /* ignore refresh errors */ }
    } catch(e){ 
      const msg = (e as Error).message || '';
      const wasCancelled = /cancelled/i.test(msg);
      if (wasCancelled) {
        toast('Đã hủy tiến trình upload/import');
      } else {
        toast.error('Lỗi: ' + (e as Error).message);
      }
      // Note: No auto-rollback for AddEpisode (episode should persist even if optional media fails)
      // User can manually delete episode via ContentDetailPage if needed
    } finally { setBusy(false); }
  };

  const onCancelAll = () => {
    // Always show confirmation modal (like AdminEpisodeUpdatePage)
    setConfirmCancel(true);
  };

  const executeCancel = async () => {
    // If episode was already created (import succeeded), rollback (delete it)
    if (importSucceededRef.current) {
      try {
        setDeletionPercent(10);
        
        // Simulate deletion progress animation
        const deleteTimer = window.setInterval(() => {
          setDeletionPercent((p) => (p < 70 ? p + 5 : p < 90 ? p + 2 : p));
        }, 200);
        
        setDeletionProgress({ stage: 'Đang xóa episode...', details: 'Rollback episode đã tạo' });
        const deleteRes = await apiDeleteEpisode({ filmSlug: contentSlug!, episodeNum });
        
        if (deleteTimer) window.clearInterval(deleteTimer);
        setDeletionPercent(100);
        
        if ('error' in deleteRes) {
          toast.error('Rollback thất bại: ' + deleteRes.error);
          setDeletionProgress(null);
          setDeletionPercent(0);
          setConfirmCancel(false);
          return;
        }
        
        setDeletionProgress({ stage: 'Hoàn tất', details: `Đã xóa ${deleteRes.cards_deleted} cards, ${deleteRes.media_deleted} media files` });
        console.log('✅ Rollback: deleted episode', deleteRes.cards_deleted, 'cards:', deleteRes.media_deleted, 'media');
        
        setTimeout(() => {
          toast.success('Đã rollback thành công');
          // Reset all state
          cancelRequestedRef.current = true;
          try { uploadAbortRef.current?.abort(); } catch (err) { void err; }
          setStage('idle');
          setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
          setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
          setImagesDone(0); setAudioDone(0);
          setImportDone(false); setStatsDone(false);
          importSucceededRef.current = false;
          setBusy(false);
          setConfirmCancel(false);
          setDeletionProgress(null);
          setDeletionPercent(0);
          // Refresh episodes list
          apiListEpisodes(contentSlug || '').then(eps => {
            setExistingEpisodes(eps.map(r => ({ episode_number: r.episode_number, title: r.title })));
          }).catch(() => {});
        }, 600);
      } catch (err) {
        console.error('Rollback error:', err);
        toast.error('Rollback thất bại: ' + (err as Error).message);
        setDeletionProgress(null);
        setDeletionPercent(0);
        setConfirmCancel(false);
      }
    } else {
      // Episode not created yet, just cancel uploads
      cancelRequestedRef.current = true;
      try { uploadAbortRef.current?.abort(); } catch (err) { void err; }
      setStage('idle');
      setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
      setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
      setImagesDone(0); setAudioDone(0);
      setImportDone(false); setStatsDone(false);
      importSucceededRef.current = false;
      setBusy(false);
      setConfirmCancel(false);
      toast('Đã hủy tiến trình');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="admin-section-header">
        <h2 className="admin-title">Add Episode: {contentSlug}</h2>
        <button
          className="admin-btn secondary"
          onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}`)}
        >← Back</button>
      </div>
      {!isAdmin && (
        <div className="text-xs text-red-400">
          Admin access required.{requireKey ? ' Set Admin Key in the SideNav.' : ''}
        </div>
      )}
      {/* Quick Guide */}
      {isAdmin && (
        <div className="admin-panel space-y-3">
          <div className="text-sm font-semibold">Hướng dẫn nhanh (Thêm Episode)</div>
          <div className="admin-subpanel text-xs space-y-2">
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Content Slug cố định: {contentSlug}</li>
              <li>Episode Num: chọn số tập mới (tránh trùng, sẽ hiện cảnh báo nếu trùng).</li>
              <li>CSV bắt buộc: start,end + cột phụ đề cho main language {filmMainLang} (sentence auto, type tùy chọn).</li>
              <li>Media tuỳ chọn: Cover tập, Full Audio/Video tập.</li>
              <li>Card media: ảnh (.jpg) & audio (.mp3/.wav) cho từng card.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Episode meta */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Episode Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Main Language</label>
            <div className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none flex items-center gap-2">
              <span className={`fi fi-${countryCodeForLang(filmMainLang)}`}></span>
              <span>{langLabel(filmMainLang)} ({canonicalizeLangCode(filmMainLang) || filmMainLang})</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Num</label>
            <input
              type="number"
              min={1}
              className="admin-input"
              value={episodeNum}
              onChange={e => {
                const val = Math.max(1, Number(e.target.value) || 1);
                setEpisodeNum(val);
                setEpNumStatus('checking');
                if (checkTimer.current) clearTimeout(checkTimer.current);
                checkTimer.current = setTimeout(() => {
                  setEpNumStatus(existingEpisodeNums.has(val) ? 'duplicate' : 'new');
                }, 350);
              }}
            />
            {epNumStatus === 'checking' && (
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            )}
            {epNumStatus === 'new' && (
              <CheckCircle className="w-4 h-4 text-green-400" />
            )}
            {epNumStatus === 'duplicate' && (
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Title</label>
            <input className="admin-input" value={episodeTitle} onChange={e => setEpisodeTitle(e.target.value)} placeholder="Optional episode title" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Description</label>
            <input 
              className="admin-input" 
              value={episodeDescription} 
              onChange={e => setEpisodeDescription(e.target.value)} 
              placeholder="Optional episode description"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-cover" type="checkbox" checked={addEpCover} onChange={e => setAddEpCover(e.target.checked)} />
              <label htmlFor="chk-ep-cover" className="cursor-pointer">Add Cover (Portrait/Episode)</label>
            </div>
            {addEpCover && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg" onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug + '_' + episodeNum}/cover/cover.jpg</div>
              </>
            )}
          </div>

          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-audio" type="checkbox" checked={addEpAudio} onChange={e => setAddEpAudio(e.target.checked)} />
              <label htmlFor="chk-ep-audio" className="cursor-pointer">Add Full Audio</label>
            </div>
            {addEpAudio && (
              <>
                <input id="ep-full-audio" type="file" accept="audio/mpeg,audio/wav" onChange={e => setHasEpAudioFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug + '_' + episodeNum}/full/audio.mp3</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-video" type="checkbox" checked={addEpVideo} onChange={e => setAddEpVideo(e.target.checked)} />
              <label htmlFor="chk-ep-video" className="cursor-pointer">Add Full Video</label>
            </div>
            {addEpVideo && (
              <>
                <input id="ep-full-video" type="file" accept="video/mp4" onChange={e => setHasEpVideoFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug + '_' + episodeNum}/full/video.mp4</div>
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
          <button type="button" title="Refresh / Re-import CSV" onClick={() => { if (csvRef.current) { csvRef.current.value = ''; csvRef.current.click(); } }} className="admin-btn secondary flex items-center gap-1">
            <RefreshCcw className="w-4 h-4" />
            <span className="text-xs">Refresh</span>
          </button>
          <button type="button" className="admin-btn" onClick={() => {
            const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang;
            // Updated template: sentence & type columns removed (sentence derived from main language subtitle, type optional)
            const headers = ['start','end',mainCanon];
            const sample = [ ['0.0','2.5','Sample sentence'] ];
            const csv = [headers.join(','), ...sample.map(r=>r.join(','))].join('\n');
            const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`episode_template_${mainCanon}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }}>Download template</button>
        </div>
        {csvFileName && <div className="text-xs text-gray-500">{csvFileName}</div>}
        {csvHeaders.length > 0 && mainLangHeaderOptions.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-300">Main Language column ({langLabel(filmMainLang)}):</label>
            <select
              className="admin-input !py-1 !px-2 max-w-xs"
              value={mainLangHeaderOverride || mainLangHeader || mainLangHeaderOptions[0]}
              onChange={e => setMainLangHeaderOverride(e.target.value)}
            >
              {mainLangHeaderOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-xs text-gray-500">Prefers non-CC by default</span>
          </div>
        )}
        <CsvPreviewPanel
          csvHeaders={csvHeaders}
          csvRows={csvRows}
          csvValid={csvValid}
          csvErrors={csvErrors}
          csvWarnings={csvWarnings}
          unrecognizedHeaders={unrecognizedHeaders}
          reservedHeaders={reservedHeaders}
          ambiguousHeaders={ambiguousHeaders}
          confirmedAsLanguage={confirmedAsLanguage}
          requiredOriginals={requiredOriginals}
          mainLangHeader={mainLangHeader}
          mainLangHeaderOverride={mainLangHeaderOverride}
          recognizedSubtitleHeaders={recognizedSubtitleHeaders}
        />
        
        {/* Ambiguous column checkboxes */}
        {ambiguousHeaders.length > 0 && (
          <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/40 rounded-lg space-y-2">
            <div className="text-sm font-semibold text-yellow-300">⚠️ Xác nhận cột có thể là ngôn ngữ hoặc cột hệ thống:</div>
            {ambiguousHeaders.map(col => {
              const isId = col.toLowerCase() === 'id';
              const isIn = col.toLowerCase() === 'in';
              const isConfirmed = confirmedAsLanguage.has(col);
              return (
                <div key={col} className="flex items-start gap-3 text-sm p-2 bg-black/20 rounded">
                  <input
                    id={`ambiguous-${col}`}
                    type="checkbox"
                    checked={isConfirmed}
                    onChange={(e) => {
                      const newSet = new Set(confirmedAsLanguage);
                      if (e.target.checked) {
                        newSet.add(col);
                      } else {
                        newSet.delete(col);
                      }
                      setConfirmedAsLanguage(newSet);
                    }}
                    className="mt-0.5"
                  />
                  <label htmlFor={`ambiguous-${col}`} className="cursor-pointer select-none flex-1">
                    <span className="text-yellow-200 font-semibold">"{col}"</span>
                    {isConfirmed ? (
                      <span className="text-green-300"> ✓ Được dùng như ngôn ngữ Indonesian</span>
                    ) : (
                      <span className="text-gray-400"> → Sẽ bị bỏ qua (cột hệ thống)</span>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">
                      {isId && "Tick để dùng như ngôn ngữ Indonesian (id), bỏ trống để ignore như cột ID."}
                      {isIn && "Tick để dùng như ngôn ngữ Indonesian (in), bỏ trống để ignore như cột hệ thống."}
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Card Media */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Card Media Files</div>
        {/* File count validation warnings */}
        {csvRows.length > 0 && (imageFiles.length > 0 || audioFiles.length > 0) && (
          <div className="space-y-2">
            {imageFiles.length !== csvRows.length && (
              <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-600/40 rounded-lg">
                <span className="text-yellow-400 text-lg">⚠️</span>
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-yellow-300 mb-1">Số lượng ảnh không khớp với số cards</div>
                  <div className="text-yellow-200/90 space-y-1">
                    <div>• Cards trong CSV: <span className="font-semibold text-yellow-100">{csvRows.length}</span></div>
                    <div>• Ảnh đã chọn: <span className="font-semibold text-yellow-100">{imageFiles.length}</span></div>
                    <div className="text-xs text-yellow-200/70 mt-2">
                      💡 Nên upload đúng {csvRows.length} file ảnh để khớp với số cards.
                      {imageFiles.length < csvRows.length && ' Một số cards sẽ thiếu ảnh.'}
                      {imageFiles.length > csvRows.length && ' Một số ảnh sẽ bị bỏ qua.'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {audioFiles.length !== csvRows.length && (
              <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-600/40 rounded-lg">
                <span className="text-yellow-400 text-lg">⚠️</span>
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-yellow-300 mb-1">Số lượng audio không khớp với số cards</div>
                  <div className="text-yellow-200/90 space-y-1">
                    <div>• Cards trong CSV: <span className="font-semibold text-yellow-100">{csvRows.length}</span></div>
                    <div>• Audio đã chọn: <span className="font-semibold text-yellow-100">{audioFiles.length}</span></div>
                    <div className="text-xs text-yellow-200/70 mt-2">
                      💡 Nên upload đúng {csvRows.length} file audio để khớp với số cards.
                      {audioFiles.length < csvRows.length && ' Một số cards sẽ thiếu audio.'}
                      {audioFiles.length > csvRows.length && ' Một số audio sẽ bị bỏ qua.'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {imageFiles.length !== audioFiles.length && imageFiles.length > 0 && audioFiles.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-orange-900/20 border border-orange-600/40 rounded-lg">
                <span className="text-orange-400 text-lg">⚠️</span>
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-orange-300 mb-1">Số lượng ảnh và audio không bằng nhau</div>
                  <div className="text-orange-200/90 space-y-1">
                    <div>• Ảnh: <span className="font-semibold text-orange-100">{imageFiles.length}</span></div>
                    <div>• Audio: <span className="font-semibold text-orange-100">{audioFiles.length}</span></div>
                    <div className="text-xs text-orange-200/70 mt-2">
                      💡 Số lượng ảnh và audio nên bằng nhau để mỗi card có đủ media.
                    </div>
                  </div>
                </div>
              </div>
            )}
            {imageFiles.length === csvRows.length && audioFiles.length === csvRows.length && imageFiles.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-green-900/20 border border-green-600/40 rounded-lg">
                <span className="text-green-400 text-lg">✓</span>
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-green-300">Số lượng files khớp hoàn hảo!</div>
                  <div className="text-green-200/90 text-xs mt-1">{csvRows.length} cards = {imageFiles.length} ảnh = {audioFiles.length} audio</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Images (.jpg)</div>
            <input type="file" accept="image/jpeg" multiple onChange={onPickImages} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
          </div>
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Audio (.mp3 / .wav)</div>
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
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <input id="infer-ids" type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} />
                <label htmlFor="infer-ids" className="text-sm select-none">Infer IDs</label>
              </div>
              <div className="flex items-center gap-2 flex-1">
                <input id="replace-cards" type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} />
                <label htmlFor="replace-cards" className="text-sm select-none">Replace existing cards</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions + Progress */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          <button className="admin-btn primary" disabled={busy || !canCreate} onClick={onCreateEpisode} title={!isAdmin ? 'Requires allowed admin email + key' : undefined}>{busy? 'Processing...' : 'Create Episode'}</button>
          {busy && stage !== 'done' && (
            <button type="button" className="admin-btn danger" onClick={onCancelAll} title="Cancel current upload/import">Stop</button>
          )}
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === 'done') && (
          <div className="admin-panel text-xs space-y-2">
            {/* Progress items in actual execution order */}
            {/* 1-2. Card Media (images + audio in parallel) */}
            <div className="flex justify-between"><span>1. Images</span><span>{imagesDone}/{imagesTotal}</span></div>
            <div className="flex justify-between"><span>2. Audio</span><span>{audioDone}/{audioTotal}</span></div>
            {/* 3. Import CSV */}
            <div className="flex justify-between">
              <span>3. Import CSV</span>
              <span>{importDone ? '✓' : stage === 'import' ? '...' : (imagesDone === imagesTotal && audioDone === audioTotal ? 'waiting' : 'pending')}</span>
            </div>
            {/* 4-6. Episode-level optional media (after import) */}
            {addEpCover && hasEpCoverFile && (
              <ProgressItem label="4. Episode Cover" done={epCoverDone > 0} pending={stage === 'ep_cover' || (importDone && epCoverDone === 0)} />
            )}
            {addEpAudio && hasEpAudioFile && (
              <ProgressItem label="5. Episode Full Audio" done={epFullAudioDone > 0} pending={stage === 'ep_full_audio' || (importDone && epFullAudioDone === 0)} />
            )}
            {addEpVideo && hasEpVideoFile && (
              <div className="flex justify-between">
                <span>6. Episode Full Video</span>
                <span>
                  {epFullVideoDone > 0
                    ? '✓'
                    : stage === 'ep_full_video' && epFullVideoBytesTotal > 0
                      ? `${Math.min(100, Math.round((epFullVideoBytesDone / epFullVideoBytesTotal) * 100))}%`
                      : (importDone ? 'waiting' : 'pending')}
                </span>
              </div>
            )}
            {/* 7. Calculate Stats (final step) */}
            <div className="flex justify-between">
              <span>7. Calculating Stats</span>
              <span>{statsDone ? '✓' : stage === 'calculating_stats' ? '...' : (importDone ? 'waiting' : 'pending')}</span>
            </div>
            {/* Progress bar */}
            <div className="mt-2"><ProgressBar percent={progress} /></div>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deletionProgress && setConfirmCancel(false)}>
          <div 
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" 
            onClick={(e) => e.stopPropagation()}
          >
            {deletionProgress ? (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-[#f5d0fe]">Đang rollback...</h3>
                <div className="text-sm text-[#e9d5ff] space-y-2">
                  <div><span className="text-[#f9a8d4] font-semibold">{deletionProgress.stage}</span></div>
                  <div className="text-xs text-gray-400">{deletionProgress.details}</div>
                </div>
                <ProgressBar percent={deletionPercent} />
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận dừng quá trình</h3>
                <p className="text-[#f5d0fe] mb-2">Bạn có muốn dừng quá trình thêm Episode?</p>
                <p className="text-sm text-[#e9d5ff] mb-4">Stage hiện tại: <span className="text-[#f9a8d4] font-semibold">{stage}</span></p>
                {importSucceededRef.current ? (
                  <p className="text-sm text-[#fbbf24] mb-4">⚠️ Episode đã được tạo. Nếu dừng, hệ thống sẽ <strong>rollback (xóa episode)</strong>!</p>
                ) : (
                  <p className="text-sm text-[#e9d5ff] mb-4">Episode chưa được tạo. Dừng sẽ hủy quá trình upload.</p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    className="admin-btn secondary"
                    onClick={() => setConfirmCancel(false)}
                  >
                    Hủy
                  </button>
                  <button
                    className="admin-btn danger"
                    onClick={executeCancel}
                  >
                    {importSucceededRef.current ? 'Dừng & Rollback' : 'Dừng'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressItem({ label, done, pending }: { label: string; done: boolean; pending: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{done ? '✓' : pending ? '...' : 'pending'}</span>
    </div>
  );
}
