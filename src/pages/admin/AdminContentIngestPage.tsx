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
import { XCircle, CheckCircle, HelpCircle, Film, Clapperboard, Book as BookIcon, AudioLines, Loader2, RefreshCcw } from "lucide-react";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "../../types/content";
import type { ContentType } from "../../types/content";
import { langLabel, canonicalizeLangCode, expandCanonicalToAliases } from "../../utils/lang";
import { detectSubtitleHeaders, categorizeHeaders } from "../../utils/csvDetection";
import ProgressBar from "../../components/ProgressBar";
import FlagDisplay from "../../components/FlagDisplay";
import CsvPreviewPanel from "../../components/CsvPreviewPanel";

// Normalize slug: remove accents, convert to lowercase, replace spaces with underscores, keep only safe characters
function normalizeSlug(input: string): string {
  // Normalize unicode characters (NFD = decompose accents from base characters)
  let normalized = input.normalize('NFD');
  // Remove combining diacritical marks (accents)
  normalized = normalized.replace(/[\u0300-\u036f]/g, '');
  // Convert to lowercase
  normalized = normalized.toLowerCase();
  // Replace spaces with underscores
  normalized = normalized.replace(/\s+/g, '_');
  // Keep only alphanumeric, underscore, and hyphen (safe for URLs and file paths)
  normalized = normalized.replace(/[^a-z0-9_-]/g, '');
  // Collapse multiple underscores/hyphens into single underscore
  normalized = normalized.replace(/[_-]+/g, '_');
  // Remove leading/trailing underscores or hyphens (do this LAST)
  normalized = normalized.replace(/^[_-]+|[_-]+$/g, '');
  return normalized;
}

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
  const [episodeDescription, setEpisodeDescription] = useState("");
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
  const [langQuery, setLangQuery] = useState("");
  const ALL_LANG_OPTIONS: string[] = [
    "en","vi","ja","ko","zh","zh_trad","id","th","ms","yue",
    "ar","eu","bn","ca","hr","cs","da","nl","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","it","ml","no","nb","pl","pt","pt_br","pt_pt","ro","ru","es","es_la","es_es","sv","se","ta","te","tr","uk",
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
  const [csvValid, setCsvValid] = useState<boolean | null>(null);
    const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState<string>("");
  // Separate subtitle warnings for teal display
  const [csvSubtitleWarnings, setCsvSubtitleWarnings] = useState<string[]>([]);
  // Allow selecting which CSV header to treat as Main Language subtitle
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string>("");
  // Reserved column confirmation state (for ambiguous columns like 'id' which could be Indonesian)
  const [confirmedAsLanguage, setConfirmedAsLanguage] = useState<Set<string>>(new Set());

  // Media selection state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);

  // Optional media toggles (film-level full media removed per new schema)
  const [addCover, setAddCover] = useState(false);
  const [addCoverLandscape, setAddCoverLandscape] = useState(false);
  const [addEpCover, setAddEpCover] = useState(false);
  const [addEpAudio, setAddEpAudio] = useState(false);
  const [addEpVideo, setAddEpVideo] = useState(false);
  const [epFullAudioExt, setEpFullAudioExt] = useState<'mp3' | 'wav'>('mp3');

  // Progress state
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [coverDone, setCoverDone] = useState(0);
  const [coverLandscapeDone, setCoverLandscapeDone] = useState(0);
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
  // Stop / rollback modal state (similar to AdminEpisodeUpdatePage)
  const [confirmStop, setConfirmStop] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<{stage: string; details: string} | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);
  // File presence flags for optional uploads (to drive validation reliably)
  const [hasCoverFile, setHasCoverFile] = useState(false);
  const [hasCoverLandscapeFile, setHasCoverLandscapeFile] = useState(false);
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

  // Helper: find header matching a canonical language code (placed early to avoid TS use-before-declare)
  const findHeaderForLang = useCallback((headers: string[], lang: string): string | null => {
    const rawAliases = expandCanonicalToAliases(lang);
    const normalizedAliases = rawAliases.map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
    const variantAliases = rawAliases.filter(a => /\(.+\)/.test(a)).map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
    const headerNorms = headers.map(h => ({ orig: h, norm: h.toLowerCase().replace(/[_\s-]/g, "" ) }));
    if (lang.toLowerCase() === 'id') {
      const confirmedId = headers.find(h => (confirmedAsLanguage.has(h) || confirmedAsLanguage.has(h.toLowerCase())) && h.trim().toLowerCase() === 'id');
      if (confirmedId) return confirmedId;
    }
    for (const v of variantAliases) {
      const found = headerNorms.find(h => h.norm === v);
      if (found) return found.orig;
    }
    for (const a of normalizedAliases) {
      const found = headerNorms.find(h => h.norm === a);
      if (found) return found.orig;
    }
    return null;
  }, [confirmedAsLanguage]);

  const validateCsv = useCallback((headers: string[], rows: Record<string, string>[]) => {
    const errors: string[] = [];
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
    const recognizedSubtitleHeaders = detectSubtitleHeaders(headers, confirmedAsLanguage);
    const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    // Check if main language column exists
    const foundMainHeader = findHeaderForLang(headers, mainLanguage);
    if (!foundMainHeader) {
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
    // Determine which header is the active Main Language column (override > auto-detect)
    const selectedMainHeader = mainLangHeaderOverride || (findHeaderForLang(headers, mainLanguage) || "");
    // Build a subtitle headers set excluding the selected main language header so it is not double-counted
    const subtitleHeadersExcludingMain = new Set<string>(
      Array.from(recognizedSubtitleHeaders).filter(h => h !== selectedMainHeader)
    );
    // row required cell checks (limit to 50 errors)
    let ec = 0;
    const maxErr = 50;
    const emptySubtitleRows: number[] = [];
    const emptyMainLangRows: number[] = [];
    rows.forEach((row, i) => {
      required.forEach(k => {
        const orig = headerMap[k];
        const v = orig ? (row[orig] || "").toString().trim() : "";
        if (!v) { errors.push(`Hàng ${i + 1}: cột "${k}" trống.`); ec++; }
      });
      // Check for empty subtitle cells (excluding main header) -> warning only
      if (ec < maxErr) {
        let hasEmptySubtitle = false;
        subtitleHeadersExcludingMain.forEach((hdr) => {
          // Skip ambiguous columns that haven't been confirmed
          const hdrLow = hdr.toLowerCase();
          const isAmbiguous = hdrLow === 'id' || hdrLow === 'in';
          if (isAmbiguous && !confirmedAsLanguage.has(hdr)) return;
          const val = (row[hdr] || "").toString().trim();
          if (!val) { hasEmptySubtitle = true; }
        });
        if (hasEmptySubtitle) {
          emptySubtitleRows.push(i + 1);
        }
      }
      // Track empty Main Language cells for unavailable notice
      if (selectedMainHeader) {
        const mainVal = (row[selectedMainHeader] || "").toString().trim();
        if (!mainVal) emptyMainLangRows.push(i + 1);
      }
      if (ec >= maxErr) return;
    });
    
      // Build warnings separately (non-blocking issues)
      const warnings: string[] = [];
    if (emptyMainLangRows.length > 0) {
      const rowList = emptyMainLangRows.slice(0, 10).join(', ') + (emptyMainLangRows.length > 10 ? '...' : '');
      warnings.push(`${emptyMainLangRows.length} cards thiếu Main Language (hàng: ${rowList}). Những cards này sẽ bị đánh dấu unavailable.`);
    }
    const subtitleWarnings: string[] = [];
    if (emptySubtitleRows.length > 0) {
      const rowList = emptySubtitleRows.slice(0, 10).join(', ') + (emptySubtitleRows.length > 10 ? '...' : '');
      subtitleWarnings.push(`${emptySubtitleRows.length} cards thiếu subtitle (hàng: ${rowList}). Thiếu này sẽ được bỏ qua khi upload, không làm card unavailable.`);
    }
    
      setCsvErrors(errors);
      setCsvWarnings(warnings);
    setCsvSubtitleWarnings(subtitleWarnings);
    setCsvValid(errors.length === 0);
  }, [mainLanguage, confirmedAsLanguage, mainLangHeaderOverride, findHeaderForLang]);

  // Compute ambiguousHeaders for UI display (checkbox prompt)
  const ambiguousHeaders = useMemo(() => {
    if (!csvHeaders.length) return [];
    const recognizedSubtitleHeaders = detectSubtitleHeaders(csvHeaders, confirmedAsLanguage);
    const { ambiguousHeaders: ambiguous } = categorizeHeaders(csvHeaders, confirmedAsLanguage, recognizedSubtitleHeaders);
    return ambiguous;
  }, [csvHeaders, confirmedAsLanguage]);

  const mainLangHeader = useMemo(() => findHeaderForLang(csvHeaders, mainLanguage), [csvHeaders, mainLanguage, findHeaderForLang]);
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
  useEffect(() => { if (!addCoverLandscape) setHasCoverLandscapeFile(false); }, [addCoverLandscape]);
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
    const coverLandscapeOk = !addCoverLandscape || hasCoverLandscapeFile;
    const epCoverOk = !addEpCover || hasEpCoverFile;
    const epAudioOk = !addEpAudio || hasEpAudioFile;
    const epVideoOk = !addEpVideo || hasEpVideoFile;
    const optionalUploadsOk = coverOk && coverLandscapeOk && epCoverOk && epAudioOk && epVideoOk;
    return !!(hasUser && emailOk && keyOk && slugOk && csvOk && titleOk && typeOk && cardMediaOk && optionalUploadsOk);
  }, [user, allowedEmails, requireKey, adminKey, pass, filmId, slugChecked, slugAvailable, csvValid, title, contentType, imageFiles.length, audioFiles.length, addCover, addCoverLandscape, addEpCover, addEpAudio, addEpVideo, hasCoverFile, hasCoverLandscapeFile, hasEpCoverFile, hasEpAudioFile, hasEpVideoFile]);

  // Handlers
  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    setCsvFileName(f.name);
    // Reset confirmed language columns when new file is loaded
    setConfirmedAsLanguage(new Set());
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
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setImageFiles(files);
  };
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAudioFiles(files);
  };

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
  const doUploadCoverLandscape = async (): Promise<string | undefined> => {
    if (!addCoverLandscape) return undefined;
    const file = (document.getElementById("cover-landscape-file") as HTMLInputElement)?.files?.[0];
    if (!file) return undefined;
    setStage("cover_landscape");
    await uploadCoverImage({ filmId, episodeNum, file, landscape: true });
    const url = r2Base ? `${r2Base}/items/${filmId}/cover_image/cover_landscape.jpg` : `/items/${filmId}/cover_image/cover_landscape.jpg`;
    setCoverLandscapeDone(1);
    toast.success("Cover landscape uploaded");
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
      setCoverDone(0); setCoverLandscapeDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      // 1. Upload cover for content (if any)
      const uploadedCoverUrl = await doUploadCover().catch(() => undefined);
      await doUploadCoverLandscape().catch(() => undefined);
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
        episode_description: episodeDescription || undefined,
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
        // Build confirmed ambiguous language header map (e.g., 'id'/'in' → Indonesian)
        const confirmedMap: Record<string, string> = {};
        confirmedAsLanguage.forEach((hdr) => {
          const low = hdr.trim().toLowerCase();
          if (low === 'id' || low === 'in') confirmedMap['id'] = hdr;
        });
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
          confirmedLanguageHeaders: Object.keys(confirmedMap).length ? confirmedMap : undefined,
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

  const requestStop = () => {
    setConfirmStop(true);
  };

  const executeRollback = async () => {
    if (!(importSucceededRef.current && createdFilmRef.current)) {
      // Nothing created; just abort uploads
      performSimpleCancel();
      return;
    }
    cancelRequestedRef.current = true;
    try { uploadAbortRef.current?.abort(); } catch { /* ignore abort errors */ }
    setDeletionPercent(5);
    setDeletionProgress({ stage: 'Đang bắt đầu rollback...', details: 'Chuẩn bị xóa content & episode' });
    let fastTimer: number | undefined;
    let slowTimer: number | undefined;
    try {
      fastTimer = window.setInterval(() => {
        setDeletionPercent(p => (p < 65 ? p + 5 : p));
      }, 180);
      // Perform deletion
      const filmRes = await apiDeleteItem(createdFilmRef.current!);
      if (fastTimer) window.clearInterval(fastTimer);
      setDeletionProgress({ stage: 'Đang xóa media...', details: 'Xóa cards & files liên quan' });
      slowTimer = window.setInterval(() => {
        setDeletionPercent(p => (p < 90 ? p + 2 : p));
      }, 600);
      if ('error' in filmRes) {
        setDeletionProgress({ stage: 'Rollback lỗi', details: filmRes.error });
        toast.error('Rollback thất bại: ' + filmRes.error);
      } else {
        setDeletionPercent(100);
        setDeletionProgress({ stage: 'Hoàn tất', details: `Đã xóa ${filmRes.cards_deleted} cards, ${filmRes.media_deleted} media files` });
        toast.success('Đã rollback thành công');
      }
      // Reset slug check state so user can retry
      setSlugChecked(false); setSlugAvailable(null);
    } catch (err) {
      if (fastTimer) window.clearInterval(fastTimer);
      if (slowTimer) window.clearInterval(slowTimer);
      console.error('Rollback error:', err);
      toast.error('Rollback lỗi: ' + (err as Error).message);
    } finally {
      if (fastTimer) window.clearInterval(fastTimer);
      if (slowTimer) window.clearInterval(slowTimer);
      // Final cleanup
      performSimpleCancel(true); // keep confirmStop open until user closes manually
    }
  };

  const performSimpleCancel = (keepModal?: boolean) => {
    cancelRequestedRef.current = true;
    try { uploadAbortRef.current?.abort(); } catch { /* ignore abort errors */ }
    setStage('idle');
    setCoverDone(0); setCoverLandscapeDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
    setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
    setImagesDone(0); setAudioDone(0); setImagesTotal(0); setAudioTotal(0);
    setImportDone(false); setStatsDone(false);
    importSucceededRef.current = false;
    createdFilmRef.current = null; createdEpisodeNumRef.current = null;
    setBusy(false);
    if (!keepModal) {
      setConfirmStop(false);
      setDeletionProgress(null); setDeletionPercent(0);
    }
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
                onChange={e => {
                  // Allow free typing, only convert spaces to underscores in real-time
                  const raw = e.target.value;
                  const withUnderscores = raw.replace(/ /g, '_');
                  setFilmId(withUnderscores);
                }}
                onBlur={e => {
                  // Normalize when user leaves the field
                  const raw = e.target.value;
                  const normalized = normalizeSlug(raw);
                  if (raw !== normalized && raw.length > 0) {
                    setFilmId(normalized);
                    toast(`Slug đã được chuẩn hóa: "${raw}" → "${normalized}"`, { icon: '✨', duration: 2000 });
                  }
                }}
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
          <div className="col-span-full text-[11px] text-gray-400 italic">
            💡 Slug tự động chuẩn hóa: bỏ dấu tiếng Việt/Unicode, chỉ giữ a-z, 0-9, _ (ví dụ: "vẽ chuyện" → "ve_chuyen")
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
            <label className="w-40 text-sm">Title <span className="text-red-500">*</span></label>
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
            <label className="w-40 text-sm">Type <span className="text-red-500">*</span></label>
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
              <label htmlFor="chk-cover" className="cursor-pointer">Add Cover Portrait (jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa dọc (.jpg) lưu tại items/&lt;slug&gt;/cover_image/cover.jpg</span>
              </span>
            </div>
            {addCover && (
              <>
                <input id="cover-file" type="file" accept="image/jpeg" onChange={e => setHasCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500 break-words">Path: items/{filmId || 'your_slug'}/cover_image/cover.jpg</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-cover-landscape" type="checkbox" checked={addCoverLandscape} onChange={e => setAddCoverLandscape(e.target.checked)} />
              <label htmlFor="chk-cover-landscape" className="cursor-pointer">Add Cover Landscape (jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa ngang (.jpg) lưu tại items/&lt;slug&gt;/cover_image/cover_landscape.jpg</span>
              </span>
            </div>
            {addCoverLandscape && (
              <>
                <input id="cover-landscape-file" type="file" accept="image/jpeg" onChange={e => setHasCoverLandscapeFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500 break-words">Path: items/{filmId || 'your_slug'}/cover_image/cover_landscape.jpg</div>
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
              <label htmlFor="chk-ep-cover" className="cursor-pointer">Add Cover Landscape (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa ngang cho tập lưu tại items/&lt;slug&gt;/episodes/&lt;slug&gt;_&lt;num&gt;/cover/cover.jpg</span>
              </span>
            </div>
            {addEpCover && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg" onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500 break-words">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/cover/cover.jpg</div>
              </>
            )}
          </div>

        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                <div className="text-[11px] text-gray-500 break-words">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/audio.{epFullAudioExt}</div>
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
                <div className="text-[11px] text-gray-500 break-words">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/video.mp4</div>
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
        <CsvPreviewPanel
          csvHeaders={csvHeaders}
          csvRows={csvRows}
          csvValid={csvValid}
          csvErrors={csvErrors}
          csvWarnings={csvWarnings}
          csvSubtitleWarnings={csvSubtitleWarnings}
          confirmedAsLanguage={confirmedAsLanguage}
          requiredOriginals={requiredOriginals}
          mainLangHeader={mainLangHeader}
          mainLangHeaderOverride={mainLangHeaderOverride}
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
                  <div className="font-semibold text-yellow-300 mb-1">
                    Số lượng ảnh không khớp với số cards
                  </div>
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
                  <div className="font-semibold text-yellow-300 mb-1">
                    Số lượng audio không khớp với số cards
                  </div>
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
                  <div className="font-semibold text-orange-300 mb-1">
                    Số lượng ảnh và audio không bằng nhau
                  </div>
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
                  <div className="font-semibold text-green-300">
                    Số lượng files khớp hoàn hảo!
                  </div>
                  <div className="text-green-200/90 text-xs mt-1">
                    {csvRows.length} cards = {imageFiles.length} ảnh = {audioFiles.length} audio
                  </div>
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
            <button type="button" className="admin-btn danger" onClick={requestStop} title="Cancel current upload/import">Stop</button>
          )}
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === "done") && (
          <div className="admin-panel text-xs space-y-2">
            {/* Progress items in actual execution order */}
            {/* 1. Cover (optional) */}
            {addCover && hasCoverFile && (
              <ProgressItem label="1. Cover Portrait" done={coverDone > 0} pending={stage === "cover" || (busy && coverDone === 0)} />
            )}
            {addCoverLandscape && hasCoverLandscapeFile && (
              <ProgressItem label="2. Cover Landscape" done={coverLandscapeDone > 0} pending={stage === "cover_landscape" || (busy && coverLandscapeDone === 0)} />
            )}
            {/* 2. Card Media (images + audio in parallel) */}
            <div className="flex justify-between"><span>3. Images</span><span>{imagesDone}/{imagesTotal}</span></div>
            <div className="flex justify-between"><span>4. Audio</span><span>{audioDone}/{audioTotal}</span></div>
            {/* 3. Import CSV */}
            <div className="flex justify-between">
              <span>5. Import CSV</span>
              <span>{importDone ? "✓" : stage === "import" ? "..." : (imagesDone === imageFiles.length && audioDone === audioFiles.length ? "waiting" : "pending")}</span>
            </div>
            {/* 4. Episode-level optional media (after import) */}
            {addEpCover && hasEpCoverFile && (
              <ProgressItem label="6. Episode Cover Landscape" done={epCoverDone > 0} pending={stage === "ep_cover" || (importDone && epCoverDone === 0)} />
            )}
            {addEpAudio && hasEpAudioFile && (
              <ProgressItem label="7. Episode Full Audio" done={epFullAudioDone > 0} pending={stage === "ep_full_audio" || (importDone && epFullAudioDone === 0)} />
            )}
            {addEpVideo && hasEpVideoFile && (
              <div className="flex justify-between">
                <span>8. Episode Full Video</span>
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
              <span>9. Calculating Stats</span>
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

              // 5-6. Episode-level media (optional)
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

              // 7. Calculate Stats (required)
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
      {confirmStop && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deletionProgress && setConfirmStop(false)}>
        <div className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận dừng quá trình</h3>
          <p className="text-[#f5d0fe] mb-2">Bạn có muốn dừng quá trình tạo nội dung?</p>
          <p className="text-sm text-[#e9d5ff] mb-4">Stage hiện tại: <span className="text-[#f9a8d4] font-semibold">{stage}</span></p>
          {(importSucceededRef.current && createdFilmRef.current) && (
            <p className="text-sm text-[#fbbf24] mb-4">⚠️ Import đã hoàn thành. Nếu Rollback, toàn bộ Content + Episode + Media đã upload sẽ bị xóa!</p>
          )}
          <p className="text-sm text-[#e9d5ff] mb-6">
            {(importSucceededRef.current && createdFilmRef.current)
              ? 'Chọn "Chỉ dừng upload" để giữ lại nội dung đã tạo, hoặc "Rollback" để xóa hoàn toàn.'
              : 'Chọn "Dừng" để hủy tiến trình upload ngay lập tức.'}
          </p>
          {deletionProgress && (
            <div className="mb-4 p-3 bg-[#241530] border-2 border-[#f472b6] rounded-lg">
              <div className="text-sm font-semibold text-[#f9a8d4] mb-2">{deletionProgress.stage}</div>
              <div className="text-xs text-[#e9d5ff] mb-2">{deletionProgress.details}</div>
              <ProgressBar percent={deletionPercent} />
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button
              className="admin-btn secondary"
              onClick={() => { if (!deletionProgress) { performSimpleCancel(); } }}
              disabled={!!deletionProgress}
            >
              {(importSucceededRef.current && createdFilmRef.current) ? 'Chỉ dừng upload' : 'Hủy'}
            </button>
            {(importSucceededRef.current && createdFilmRef.current) && (
              <button className="admin-btn danger" disabled={!!deletionProgress} onClick={executeRollback}>
                {deletionProgress ? 'Đang rollback...' : 'Rollback'}
              </button>
            )}
            {!(importSucceededRef.current && createdFilmRef.current) && (
              <button className="admin-btn primary" onClick={() => performSimpleCancel()}>
                Dừng
              </button>
            )}
          </div>
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
      <span>{done ? "✓" : pending ? "..." : "skip"}</span>
    </div>
  );
}
