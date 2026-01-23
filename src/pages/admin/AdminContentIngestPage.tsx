import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { useUser } from "../../context/UserContext";
import { importFilmFromCsv, type ImportFilmMeta } from "../../services/importer";
import {
  uploadCoverImage,
  uploadMediaBatch,
  uploadEpisodeCoverImage,
} from "../../services/storageUpload";
import type { MediaType } from "../../services/storageUpload";
import { apiUpdateEpisodeMeta, apiUpdateFilmMeta, apiGetFilm, apiCalculateStats, apiDeleteItem, invalidateItemsCache, apiListCategories, apiCreateCategory, apiAssessContentLevel, apiCheckReferenceData } from "../../services/cfApi";
import { getAvailableMainLanguages, invalidateGlobalCardsCache } from "../../services/firestore";
import { XCircle, CheckCircle, HelpCircle, Film, Clapperboard, Book as BookIcon, AudioLines, Video, Loader2, RefreshCcw, ArrowLeft } from "lucide-react";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "../../types/content";
import type { ContentType } from "../../types/content";
import { langLabel, canonicalizeLangCode, expandCanonicalToAliases, getFlagImageForLang } from "../../utils/lang";
import { detectSubtitleHeaders, categorizeHeaders } from "../../utils/csvDetection";
import { getFrameworkFromLanguage, getFrameworkDisplayName } from "../../utils/frameworkMapping";
import ProgressBar from "../../components/ProgressBar";
import CsvPreviewPanel from "../../components/admin/CsvPreviewPanel";
import CardMediaFiles from "../../components/admin/CardMediaFiles";
import ProgressPanel from "../../components/admin/ProgressPanel";
import "../../styles/components/admin/admin-forms.css";

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
  const { user, signInGoogle, adminKey, preferences: globalPreferences, setMainLanguage: setGlobalMainLanguage, isAdmin: checkIsAdmin } = useUser();
  const pass = (import.meta.env.VITE_IMPORT_KEY || "").toString();
  const requireKey = !!pass;
  const isAdmin = !!user && checkIsAdmin() && (!requireKey || adminKey === pass);

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
  const [imdbScore, setImdbScore] = useState<number | "">("");
  const [categoryInput, setCategoryInput] = useState(""); // Comma-separated category names
  const [categoryStatus, setCategoryStatus] = useState<Record<string, { exists: boolean; id?: string; name: string }>>({});
  const [checkedCategories, setCheckedCategories] = useState(false);

  // Dropdown state
  const [langOpen, setLangOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement | null>(null);
  const typeDropdownRef = useRef<HTMLDivElement | null>(null);
  const yearDropdownRef = useRef<HTMLDivElement | null>(null);
  const [langQuery, setLangQuery] = useState("");
  // Show all languages, with framework badge for supported ones
  const ALL_LANG_OPTIONS: string[] = [
    "en", "vi", "ja", "ko", "zh", "zh_trad", "id", "th", "ms", "yue",
    "ar", "eu", "bn", "ca", "hr", "cs", "da", "nl", "fil", "fi", "fr", "fr_ca", "gl", "de", "el", "he", "hi", "hu", "is", "it", "ml", "no", "nb", "pl", "pt", "pt_br", "pt_pt", "ro", "ru", "es", "es_la", "es_es", "sv", "se", "ta", "te", "tr", "uk", "lv",
    "fa", "ku", "ckb", "kmr", "sdh", "sl", "sr", "bg", "ur", "sq", "lt",
    "kk", "sk", "uz", "be", "bs", "mr", "mn", "et", "hy"
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
  // Framework level columns that will be ignored (auto assessment)
  const [csvFrameworkLevelIgnored, setCsvFrameworkLevelIgnored] = useState<string[]>([]);
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

  // Reference data check state
  const [referenceDataStatus, setReferenceDataStatus] = useState<{
    framework: string | null;
    exists: boolean;
    hasFrequencyData: boolean;
  } | null>(null);
  const [checkingReferenceData, setCheckingReferenceData] = useState(false);

  // Optional media toggles (film-level full media removed per new schema)
  const [addCover, setAddCover] = useState(false);
  const [addCoverLandscape, setAddCoverLandscape] = useState(false);
  const [addEpCover, setAddEpCover] = useState(false);
  // Video-specific: whether video has individual card images or uses episode cover
  const [videoHasImages, setVideoHasImages] = useState(true);

  // Progress state
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [coverDone, setCoverDone] = useState(0);
  const [coverLandscapeDone, setCoverLandscapeDone] = useState(0);
  const [epCoverDone, setEpCoverDone] = useState(0);
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
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);
  // File presence flags for optional uploads (to drive validation reliably)
  const [hasCoverFile, setHasCoverFile] = useState(false);
  const [hasCoverLandscapeFile, setHasCoverLandscapeFile] = useState(false);
  const [hasEpCoverFile, setHasEpCoverFile] = useState(false);

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
    // Strip brackets/parentheses from headers (like [CC], (CC)) before normalizing
    const headerNorms = headers.map(h => ({
      orig: h,
      norm: h.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "").replace(/[_\s-]/g, "")
    }));
    if (lang.toLowerCase() === 'id') {
      const confirmedId = headers.find(h => (confirmedAsLanguage.has(h) || confirmedAsLanguage.has(h.toLowerCase())) && h.trim().toLowerCase() === 'id');
      if (confirmedId) return confirmedId;
    }
    if (lang.toLowerCase() === 'no') {
      const confirmedNo = headers.find(h => (confirmedAsLanguage.has(h) || confirmedAsLanguage.has(h.toLowerCase())) && h.trim().toLowerCase() === 'no');
      if (confirmedNo) return confirmedNo;
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
    // Also includes framework level columns that will be ignored (auto assessment will override them)
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
      // Framework level columns (will be ignored - auto assessment will override)
      "cefr", "cefr_level", "cefr level", "cefr level",
      "jlpt", "jlpt_level", "jlpt level", "jlpt level",
      "hsk", "hsk_level", "hsk level", "hsk level",
      "topik", "topik_level", "topik level", "topik level",
      "delf", "delf_level", "delf level", "delf level",
      "dele", "dele_level", "dele level", "dele level",
      "goethe", "goethe_level", "goethe level", "goethe level",
      "testdaf", "testdaf_level", "testdaf level", "testdaf level",
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
    const knownSingles = new Set(["start", "end", "type", "length", "difficulty score", "difficulty_score", "difficultyscore", "score", "difficulty_percent", "card_difficulty"]);
    // Framework level columns that will be ignored (auto assessment will override)
    const frameworkLevelColumns = new Set([
      "cefr", "cefr level", "cefr_level", "cefr level",
      "jlpt", "jlpt level", "jlpt_level", "jlpt level",
      "hsk", "hsk level", "hsk_level", "hsk level",
      "topik", "topik level", "topik_level", "topik level",
      "delf", "delf level", "delf_level", "delf level",
      "dele", "dele level", "dele_level", "dele level",
      "goethe", "goethe level", "goethe_level", "goethe level",
      "testdaf", "testdaf level", "testdaf_level", "testdaf level"
    ]);
    const isFrameworkDynamic = (raw: string) => {
      const key = raw.trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      return /^(?:difficulty|diff)[_:\-/ ]?[a-z0-9]+(?:[_:\-/ ][a-z_]{2,8})?$/i.test(key);
    };
    const ignored: string[] = [];
    const frameworkLevelIgnored: string[] = []; // Framework level columns that will be ignored
    for (const h of headers) {
      const raw = (h || '').trim();
      if (!raw) continue;
      const low = raw.toLowerCase();
      if (RESERVED_COLUMNS.has(low)) {
        // Check if it's a framework level column (for special warning)
        if (frameworkLevelColumns.has(low)) {
          frameworkLevelIgnored.push(raw);
        }
        continue; // Skip reserved metadata columns
      }
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
    setCsvFrameworkLevelIgnored(frameworkLevelIgnored);
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
    const variantGroups: Record<string, string[]> = {
      es_es: ["es_es", "es_la"], es_la: ["es_es", "es_la"],
      pt_pt: ["pt_pt", "pt_br"], pt_br: ["pt_pt", "pt_br"],
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

  // Check categories function
  const checkCategories = async () => {
    const input = categoryInput.trim();
    if (!input) {
      toast.error('Please enter category names');
      return;
    }

    // Parse comma-separated categories
    const categoryNames = input
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    if (categoryNames.length === 0) {
      toast.error('No valid category names found');
      return;
    }

    try {
      const allCategories = await apiListCategories();

      const status: Record<string, { exists: boolean; id?: string; name: string }> = {};
      categoryNames.forEach(name => {
        const existing = allCategories.find(c => c.name.toLowerCase() === name.toLowerCase());
        status[name] = {
          exists: !!existing,
          id: existing?.id,
          name: name
        };
      });

      setCategoryStatus(status);
      setCheckedCategories(true);

      const existingCount = Object.values(status).filter(s => s.exists).length;
      const newCount = Object.values(status).filter(s => !s.exists).length;
      toast.success(`Found ${existingCount} existing, ${newCount} new categories`);
    } catch (e) {
      toast.error(`Failed to check categories: ${(e as Error).message}`);
    }
  };

  // Check reference data when main language changes
  useEffect(() => {
    const checkReferenceData = async () => {
      if (!mainLanguage) {
        setReferenceDataStatus(null);
        return;
      }
      
      const framework = getFrameworkFromLanguage(mainLanguage);
      if (!framework) {
        setReferenceDataStatus(null);
        return;
      }
      
      try {
        setCheckingReferenceData(true);
        const status = await apiCheckReferenceData(framework);
        setReferenceDataStatus({
          framework,
          ...status
        });
        
        // Only show toast if data exists (success) - don't show error for missing data
        if (status.exists) {
          toast.success(`Reference data available for ${getFrameworkDisplayName(framework)}`, { duration: 3000 });
        }
      } catch (error) {
        console.error('Failed to check reference data:', error);
        setReferenceDataStatus(null);
      } finally {
        setCheckingReferenceData(false);
      }
    };
    
    checkReferenceData();
  }, [mainLanguage]);

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

  // Auto-enable episode cover for video content without images
  useEffect(() => {
    if (contentType === 'video' && !videoHasImages && !addEpCover) {
      setAddEpCover(true);
    }
  }, [contentType, videoHasImages, addEpCover]);

  // Reset videoHasImages when contentType changes away from video
  useEffect(() => {
    if (contentType !== 'video') {
      setVideoHasImages(true); // Reset to default
    }
  }, [contentType]);

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
    const slugOk = !!filmId && slugChecked && slugAvailable === true;
    const csvOk = csvValid === true;
    const titleOk = (title || "").trim().length > 0;
    const typeOk = !!contentType;
    const isVideo = contentType === 'video';
    // For video with images: require both image and audio files (like other types)
    // For video without images: only require audio files, episode cover is required
    // For other types: require both image and audio files
    const cardMediaOk = isVideo
      ? (videoHasImages
        ? (imageFiles.length > 0 && audioFiles.length > 0)
        : audioFiles.length > 0)
      : imageFiles.length > 0 && audioFiles.length > 0;
    // Optional toggles: if checked, require a file chosen for that input (use reactive flags)
    const coverOk = !addCover || hasCoverFile;
    const coverLandscapeOk = !addCoverLandscape || hasCoverLandscapeFile;
    // For video without images: episode cover is required (must be checked and have file)
    // For video with images or other types: episode cover is optional
    const epCoverOk = (isVideo && !videoHasImages)
      ? (addEpCover && hasEpCoverFile)
      : (!addEpCover || hasEpCoverFile);
    const optionalUploadsOk = coverOk && coverLandscapeOk && epCoverOk;
    return !!(isAdmin && slugOk && csvOk && titleOk && typeOk && cardMediaOk && optionalUploadsOk);
  }, [isAdmin, filmId, slugChecked, slugAvailable, csvValid, title, contentType, videoHasImages, imageFiles.length, audioFiles.length, addCover, addCoverLandscape, addEpCover, hasCoverFile, hasCoverLandscapeFile, hasEpCoverFile]);

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
    // Extract extension from file type (avif, webp, or jpg)
    const isAvif = file.type === 'image/avif';
    const isWebP = file.type === 'image/webp';
    const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
    const url = r2Base ? `${r2Base}/items/${filmId}/cover_image/cover.${ext}` : `/items/${filmId}/cover_image/cover.${ext}`;
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
    // Extract extension from file type (avif, webp, or jpg)
    const isAvif = file.type === 'image/avif';
    const isWebP = file.type === 'image/webp';
    const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
    const url = r2Base ? `${r2Base}/items/${filmId}/cover_image/cover_landscape.${ext}` : `/items/${filmId}/cover_image/cover_landscape.${ext}`;
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
    if (!isAdmin) { toast.error("Admin access required"); return; }
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
      setCoverDone(0); setCoverLandscapeDone(0); setEpCoverDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      // 1. Upload cover for content (if any)
      const uploadedCoverUrl = await doUploadCover().catch(() => undefined);
      const uploadedCoverLandscapeUrl = await doUploadCoverLandscape().catch(() => undefined);
      // 2. Upload card media (images/audio) for cards (these do not depend on episode row)
      // For video without images: only upload audio, skip images
      // For video with images or other types: upload both images and audio
      const uploadPromises = (contentType === 'video' && !videoHasImages)
        ? [doUploadMedia("audio", audioFiles, uploadAbortRef.current!.signal)]
        : [
          doUploadMedia("image", imageFiles, uploadAbortRef.current!.signal),
          doUploadMedia("audio", audioFiles, uploadAbortRef.current!.signal)
        ];
      await Promise.all(uploadPromises);
      if (cancelRequestedRef.current || uploadAbortRef.current?.signal.aborted) throw new Error("User cancelled");
      // 3. Import CSV to create episode 1 (must be before episode-level media upload)
      if (!csvText) { toast.error("Please select a CSV for cards"); setBusy(false); return; }
      setStage("import");
      const filmMeta: ImportFilmMeta = {
        title,
        description,
        cover_url: uploadedCoverUrl ?? coverUrl ?? "",
        cover_landscape_url: uploadedCoverLandscapeUrl,
        language: mainLanguage,
        available_subs: [],
        episodes: 1,
        total_episodes: 1,
        episode_title: episodeTitle || undefined,
        episode_description: episodeDescription || undefined,
        ...(contentType ? { type: contentType } : {}),
        ...(releaseYear !== "" ? { release_year: releaseYear } : {}),
        is_original: isOriginal,
        ...(imdbScore !== "" && imdbScore !== null ? { imdb_score: Number(imdbScore) } : {}),
        // Categories will be handled after content creation
      };
      // derive cardIds from filenames when infer enabled
      let cardIds: string[] | undefined = undefined;
      if (infer) {
        // For video without images: only use audio files for inferring IDs
        // For video with images or other types: use both image and audio files
        const all = (contentType === 'video' && !videoHasImages) ? audioFiles : [...imageFiles, ...audioFiles];
        const set = new Set<string>();
        all.forEach(f => { const m = f.name.match(/(\d+)(?=\.[^.]+$)/); if (m) { const raw = m[1]; const id = raw.length >= padDigits ? raw : raw.padStart(padDigits, "0"); set.add(id); } });
        if (set.size) { cardIds = Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); }
      }

      // Build extension maps from uploaded files to ensure DB paths match R2 files
      const imageExtensions: Record<string, string> = {};
      const audioExtensions: Record<string, string> = {};

      const buildExtMap = (files: File[], isImage: boolean) => {
        let seq = startIndex;
        const used = new Set<string>();
        files.forEach(f => {
          let cardId: string | null = null;
          if (infer) {
            const m = f.name.match(/(\d+)(?=\.[^.]+$)/);
            if (m) {
              const raw = m[1];
              cardId = raw.length >= padDigits ? raw : raw.padStart(padDigits, "0");
            }
          }
          if (!cardId) {
            cardId = String(seq).padStart(padDigits, "0");
            seq += 1;
          }
          while (used.has(cardId)) {
            const n = parseInt(cardId, 10);
            if (!Number.isNaN(n)) {
              cardId = String(n + 1).padStart(Math.max(padDigits, cardId.length), "0");
            } else {
              cardId = `${cardId}a`;
            }
          }
          used.add(cardId);

          const ext = isImage
            ? (f.type === "image/avif" ? "avif" : (f.type === "image/webp" ? "webp" : "jpg"))
            : (f.type === "audio/wav" || f.type === "audio/x-wav" ? "wav"
              : (f.type === "audio/opus" || f.type === "audio/ogg" ? "opus" : "mp3"));

          if (isImage) {
            imageExtensions[cardId] = ext;
          } else {
            audioExtensions[cardId] = ext;
          }
        });
      };

      // Only build image extension map if video has images or not video type
      if (contentType !== 'video' || videoHasImages) {
        buildExtMap(imageFiles, true);
      }
      buildExtMap(audioFiles, false);

      try {
        // Build confirmed ambiguous language header map (e.g., 'id'/'in' → Indonesian, 'no' → Norwegian)
        const confirmedMap: Record<string, string> = {};
        confirmedAsLanguage.forEach((hdr) => {
          const low = hdr.trim().toLowerCase();
          if (low === 'id' || low === 'in') confirmedMap['id'] = hdr;
          if (low === 'no') confirmedMap['no'] = hdr;
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
          imageExtensions,
          audioExtensions,
          overrideMainSubtitleHeader: mainLangHeaderOverride || undefined,
          confirmedLanguageHeaders: Object.keys(confirmedMap).length ? confirmedMap : undefined,
          videoHasImages: contentType === 'video' ? videoHasImages : undefined,
        }, () => { });
        // Mark as created for rollback tracking
        createdFilmRef.current = filmId;
        createdEpisodeNumRef.current = episodeNum;
        importSucceededRef.current = true;
        setImportDone(true);
        toast.success("Import completed");

        // Create categories if specified (only after content creation succeeds)
        if (checkedCategories && Object.keys(categoryStatus).length > 0) {
          try {
            const categoryIds: string[] = [];
            for (const status of Object.values(categoryStatus)) {
              if (status.exists && status.id) {
                // Use existing category
                categoryIds.push(status.id);
              } else {
                // Create new category
                try {
                  const result = await apiCreateCategory(status.name);
                  categoryIds.push(result.id);
                  toast.success(`Category "${status.name}" created`);
                } catch (e) {
                  console.error(`Failed to create category "${status.name}":`, e);
                  toast.error(`Failed to create category "${status.name}": ${(e as Error).message}`);
                }
              }
            }

            // Assign categories to content
            if (categoryIds.length > 0) {
              try {
                await apiUpdateFilmMeta({
                  filmSlug: filmId,
                  category_ids: categoryIds,
                });
                toast.success(`Assigned ${categoryIds.length} categories to content`);
              } catch (e) {
                console.error('Failed to assign categories:', e);
                toast.error(`Failed to assign categories: ${(e as Error).message}`);
              }
            }
          } catch (e) {
            console.error('Category creation/assignment failed:', e);
            // Non-blocking - don't fail the whole import
          }
        }
      } catch (importErr) {
        console.error("❌ Import failed:", importErr);
        toast.error("Import failed: " + (importErr as Error).message);
        throw importErr; // Re-throw to stop the process
      }
      // 4. Upload episode-level media (cover) AFTER episode row exists
      await doUploadEpisodeCover().catch(() => { });
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
      // Save video_has_images to content_items if video content
      if (contentType === 'video') {
        try {
          await apiUpdateFilmMeta({
            filmSlug: filmId,
            video_has_images: videoHasImages ? 1 : 0,
          });
        } catch (err) {
          console.warn('Failed to save video_has_images:', err);
          // Non-blocking error
        }
      }
      // Auto level assessment (always enabled)
      try {
        setStage("assessing_levels");
        toast.loading("Running auto level assessment...", { id: "auto-assessment" });
        await apiAssessContentLevel(filmId, (_progress) => {
          // Progress callback for assessment (currently not used in UI)
        });
        toast.success("Auto level assessment completed", { id: "auto-assessment" });
      } catch (err) {
        console.warn('Auto level assessment failed:', err);
        toast.error("Auto level assessment failed: " + (err as Error).message, { id: "auto-assessment" });
        // Non-blocking error - don't fail the whole import
      }
      // Post-success: refresh global main-language options and notify Search to refresh
      try {
        const langs = await getAvailableMainLanguages();
        const current = (globalPreferences.main_language) || 'en';
        if (!langs.includes(current) && langs.length) {
          await setGlobalMainLanguage(langs[0]);
        }
      } catch { /* ignore */ }
      try { invalidateGlobalCardsCache(); } catch { /* ignore */ }
      try { invalidateItemsCache(); } catch { /* ignore */ }
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
    setCoverDone(0); setCoverLandscapeDone(0); setEpCoverDone(0);
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
        <button className="admin-btn secondary flex items-center gap-1.5" onClick={() => window.location.href = '/admin/content'}>
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      {/* Auth */}
      {user ? (
        <div className="admin-panel space-y-2">
          <div className="text-sm" style={{ color: 'var(--text)' }}>Signed in as <span style={{ color: 'var(--primary)' }}>{user.email}</span></div>
          {requireKey && (
            <div className="text-xs typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Admin Key required — set it once in the SideNav.</div>
          )}
          <div className="text-sm" style={{ color: 'var(--text)' }}>Access: {isAdmin ? <span style={{ color: 'var(--success)' }}>granted (Admin role)</span> : <span style={{ color: 'var(--error)' }}>denied (No admin role)</span>}</div>
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
          <div className="typography-inter-1 admin-panel-title">Quick Guide</div>
          <div className="admin-subpanel text-xs space-y-3">
            <div style={{ color: 'var(--text)' }} className="font-semibold">A) Các trường nhập</div>
            <ul className="list-disc pl-5 space-y-1 typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>
              <li><span style={{ color: 'var(--text)' }}>Content Slug</span>: slug không dấu (vd. <code>cinderella</code>). Dùng nút Check để xác thực không trùng.</li>
              <li><span style={{ color: 'var(--text)' }}>Main Language</span>: ngôn ngữ chính.</li>
              <li><span style={{ color: 'var(--text)' }}>Title</span>, <span style={{ color: 'var(--text)' }}>Description</span> mô tả.</li>
              <li><span style={{ color: 'var(--text)' }}>Episode 1</span>: tự động tạo, không chỉnh sửa số tập ở đây.</li>
              <li><span style={{ color: 'var(--text)' }}>Episode Title</span> (tuỳ chọn).</li>
              <li><span style={{ color: 'var(--text)' }}>Type</span>: Loại nội dung: <code>movie</code>, <code>series</code>, <code>book</code>, <code>audio</code>, <code>video</code>.</li>
              <li><span style={{ color: 'var(--text)' }}>Release Year</span> (tuỳ chọn) helps categorize.</li>
              <li><span style={{ color: 'var(--text)' }}>Media tuỳ chọn</span>: Cover (content + episode), Full Audio/Video cho Episode.</li>
              <li><span style={{ color: 'var(--text)' }}>Card Media Files</span>:
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li><strong>Với Type = Video</strong>: Có 2 trường hợp:
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li><strong>Video có ảnh</strong>: Upload cả <strong>Images</strong> (.avif, .webp, hoặc .jpg) và <strong>Audio</strong> (.opus) cho từng card (giống các type khác).</li>
                      <li><strong>Video không có ảnh</strong>: Chỉ upload <strong>Audio</strong> (.opus). <strong>Episode Cover Landscape</strong> là bắt buộc (sẽ dùng làm image cho tất cả cards).</li>
                    </ul>
                  </li>
                  <li><strong>Với các Type khác</strong>: Cần upload cả <strong>Images</strong> (.avif, .webp, hoặc .jpg) và <strong>Audio</strong> (.opus) cho cards.</li>
                </ul>
              </li>
            </ul>
            <div className="admin-instructions-title">B) CSV cần</div>
            <ul className="admin-instructions-list typography-inter-4">
              <li>Cột bắt buộc: <code>start,end</code>.</li>
              <li>Phải có cột phụ đề cho Main Language ({mainLanguage}).</li>
              <li><code>type</code> tùy chọn; <code>sentence</code> tự động lấy từ phụ đề của Main Language.</li>
              <li>Hỗ trợ đa ngôn ngữ: en, vi, zh, zh_trad, yue, ja, ko, id, th, ms.</li>
              <li><code>difficulty_score</code> (0-100) + alias.</li>
              <li><strong>Framework level columns (CEFR, JLPT, HSK, etc.) sẽ bị bỏ qua</strong>: Các cột framework level trong CSV sẽ được chủ động bỏ qua. Auto Level Assessment sẽ tự động đánh giá level cho cards dựa trên reference data.</li>
              <li>Infer IDs: lấy số cuối tên file làm card id; nếu tắt dùng Pad + Start Index.</li>
            </ul>
            <div className="admin-instructions-note">
              <div>Ví dụ tối thiểu: <code>start,end,type,en</code></div>
              <div>Đảm bảo thời gian tăng dần để hiển thị ổn định.</div>
            </div>
          </div>
        </div>
      )}

      {/* Content meta */}
      <div className="admin-panel space-y-4">
        <div className="typography-inter-1 admin-panel-title">Content Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-2">
            <label className="text-sm">Content Slug</label>
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
                <div className="admin-form-input-icon group">
                  {slugChecking && <Loader2 className="w-4 h-4 animate-spin checking" />}
                  {!slugChecking && slugChecked && slugAvailable === true && <CheckCircle className="w-4 h-4 success" />}
                  {!slugChecking && slugChecked && slugAvailable === false && <XCircle className="w-4 h-4 error" />}
                  {/* Pretty tooltip */}
                  <div className="admin-form-tooltip">
                    {slugChecking ? 'Đang kiểm tra…' : (slugAvailable ? 'Slug khả dụng - có thể tạo.' : 'Slug đã tồn tại - chọn slug khác.')}
                  </div>
                </div>
              )}
            </div>
            <div></div>
            <div className="admin-form-help typography-inter-4">
              💡 Slug tự động chuẩn hóa: bỏ dấu tiếng Việt/Unicode, chỉ giữ a-z, 0-9, _ (ví dụ: "vẽ chuyện" → "ve_chuyen")
            </div>
          </div>
          <div className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-2">
            <label className="text-sm">Main Language</label>
            <div className="relative w-full" ref={langDropdownRef}>
                <button type="button" className="admin-input admin-dropdown-button flex items-center justify-between" onClick={e => { e.preventDefault(); setLangOpen(v => !v); }}>
                  <span className="admin-dropdown-button-content flex items-center gap-2">
                    <img src={getFlagImageForLang(mainLanguage)} alt={`${mainLanguage} flag`} className="admin-flag-icon" />
                    <span>{langLabel(mainLanguage)} ({mainLanguage})</span>
                  </span>
                  <span className="admin-dropdown-arrow">▼</span>
                </button>
                {langOpen && (
                  <div className="absolute z-10 mt-1 w-full admin-dropdown-panel">
                    <div className="admin-dropdown-search-header">
                      <input
                        autoFocus
                        value={langQuery}
                        onChange={(e) => setLangQuery(e.target.value)}
                        placeholder="Search language..."
                        className="admin-input text-xs py-1 px-2"
                      />
                    </div>
                    {FILTERED_LANG_OPTIONS.map(l => {
                      const framework = getFrameworkFromLanguage(l);
                      return (
                        <div key={l} className="admin-dropdown-item" onClick={() => { setMainLanguage(l); setLangOpen(false); setLangQuery(""); }}>
                          <img src={getFlagImageForLang(l)} alt={`${l} flag`} className="admin-flag-icon" />
                          <span className="text-sm flex-1">{langLabel(l)} ({l})</span>
                          {framework ? (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--success)', color: 'var(--background)', fontSize: '10px' }}>
                              {framework}
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded opacity-50" style={{ backgroundColor: 'var(--warning)', color: 'var(--background)', fontSize: '10px' }}>
                              No framework
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {FILTERED_LANG_OPTIONS.length === 0 && (
                      <div className="px-3 py-2 text-xs text-pink-200/70">No languages match "{langQuery}".</div>
                    )}
                  </div>
                )}
            </div>
            {/* Framework Support Badge - below Main Language selector */}
            <div></div>
            <div>
              {mainLanguage && (() => {
                const framework = getFrameworkFromLanguage(mainLanguage);
                if (!framework) {
                  return (
                    <div className="text-xs px-2 py-1 rounded inline-block" style={{ backgroundColor: 'var(--warning)', color: 'var(--background)', opacity: 0.7 }}>
                      No framework support
                    </div>
                  );
                }
                // Only show badge if reference data exists in DB
                if (referenceDataStatus && referenceDataStatus.framework === framework && referenceDataStatus.exists) {
                  return (
                    <div className="text-xs px-2 py-1 rounded inline-block" style={{ backgroundColor: 'var(--success)', color: 'var(--background)' }}>
                      Auto Assessment: {getFrameworkDisplayName(framework)}
                    </div>
                  );
                }
                // Show framework name but indicate data not available
                if (referenceDataStatus && referenceDataStatus.framework === framework && !referenceDataStatus.exists) {
                  return (
                    <div className="text-xs px-2 py-1 rounded inline-block" style={{ backgroundColor: 'var(--warning)', color: 'var(--background)' }}>
                      {getFrameworkDisplayName(framework)} (no data in DB)
                    </div>
                  );
                }
                // Still checking or no status yet - only show if we have a framework
                if (checkingReferenceData) {
                  return (
                    <div className="text-xs px-2 py-1 rounded inline-block opacity-50" style={{ backgroundColor: 'var(--neutral)', color: 'var(--background)' }}>
                      {getFrameworkDisplayName(framework)} (checking...)
                    </div>
                  );
                }
                // No status yet - don't show checking if we haven't started checking
                return null;
              })()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Title <span className="text-red-500">*</span></label>
            <input className="admin-input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Release Year</label>
            <div className="relative w-full" ref={yearDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setYearOpen(v => !v); }}>
                <span>{releaseYear !== "" ? releaseYear : "(optional)"}</span>
                <span style={{ color: 'var(--sub-language-text)' }}>▼</span>
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
                  {contentType === "video" && <Video className="w-4 h-4" />}
                  <span>{contentType ? CONTENT_TYPE_LABELS[contentType] : "(required)"}</span>
                </span>
                <span style={{ color: 'var(--sub-language-text)' }}>▼</span>
              </button>
              {typeOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel">
                  {CONTENT_TYPES.map(t => (
                    <div key={t} className="admin-dropdown-item text-sm" onClick={() => { setContentType(t); setTypeOpen(false); }}>
                      {t === "movie" && <Film className="w-4 h-4" />}
                      {t === "series" && <Clapperboard className="w-4 h-4" />}
                      {t === "book" && <BookIcon className="w-4 h-4" />}
                      {t === "audio" && <AudioLines className="w-4 h-4" />}
                      {t === "video" && <Video className="w-4 h-4" />}
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
              <label htmlFor="chk-original" className="text-xs cursor-pointer whitespace-nowrap" style={{ color: 'var(--text)' }}>This is the original version (source language).</label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">IMDB Score</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              className="admin-input w-full"
              value={imdbScore}
              onChange={e => setImdbScore(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="0.0 - 10.0 (optional)"
            />
          </div>
        </div>
        {/* Video-specific: toggle for images - separate row to avoid overlap */}
        {contentType === 'video' && (
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Video Images</label>
            <div className="flex items-center gap-3 flex-1">
              <input id="chk-video-images" type="checkbox" checked={videoHasImages} onChange={e => setVideoHasImages(e.target.checked)} />
              <label htmlFor="chk-video-images" className="text-xs cursor-pointer" style={{ color: 'var(--text)' }}>
                Video has individual card images (uncheck to use episode cover for all cards)
              </label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 cursor-help" style={{ color: 'var(--sub-language-text)' }} />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded border text-[11px] leading-snug shadow-lg" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
                  Checked: Upload images for each card (like other content types). Unchecked: Use episode cover image for all cards (requires episode cover upload).
                </span>
              </span>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-1">Description</label>
          <textarea className="admin-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Categories Section */}
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-1">Categories</label>
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                className="admin-input flex-1"
                placeholder="Enter categories separated by comma (e.g., Action, Drama, Comedy)"
                value={categoryInput}
                onChange={(e) => {
                  setCategoryInput(e.target.value);
                  setCheckedCategories(false);
                  setCategoryStatus({});
                }}
              />
              <button
                type="button"
                className="admin-btn secondary"
                onClick={checkCategories}
                disabled={!categoryInput.trim()}
              >
                Check
              </button>
            </div>
            {checkedCategories && Object.keys(categoryStatus).length > 0 && (
              <div className="space-y-1">
                {Object.values(categoryStatus).map((status, idx) => (
                  <div
                    key={idx}
                    className={`text-xs px-2 py-1 rounded ${status.exists
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                  >
                    {status.exists ? (
                      <span>✓ {status.name} (exists)</span>
                    ) : (
                      <span>⚠ {status.name} (will be created)</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs typography-inter-4" style={{ color: 'var(--neutral)' }}>
              💡 Categories will only be created when content is successfully created. If creation fails, no categories will be created.
            </div>
          </div>
        </div>

        {/* Existing Episodes panel removed for E1-only creation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
              <input id="chk-cover" type="checkbox" checked={addCover} onChange={e => setAddCover(e.target.checked)} />
              <label htmlFor="chk-cover" className="cursor-pointer whitespace-nowrap">Add Cover Portrait (avif/webp/jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 cursor-help" style={{ color: 'var(--sub-language-text)' }} />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded border text-[11px] leading-snug shadow-lg" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>Ảnh bìa dọc (.avif, .webp, hoặc .jpg) lưu tại items/&lt;slug&gt;/cover_image/cover.avif (or .webp, .jpg)</span>
              </span>
            </div>
            {addCover && (
              <>
                <input id="cover-file" type="file" accept="image/jpeg,image/webp,image/avif" onChange={e => {
                  setHasCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0);
                }} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
                <div className="text-[11px] typography-inter-4 break-words" style={{ color: 'var(--neutral)' }}>Path: items/{filmId || 'your_slug'}/cover_image/cover.avif (or .webp, .jpg)</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
              <input id="chk-cover-landscape" type="checkbox" checked={addCoverLandscape} onChange={e => setAddCoverLandscape(e.target.checked)} />
              <label htmlFor="chk-cover-landscape" className="cursor-pointer whitespace-nowrap">Add Cover Landscape (avif/webp/jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 cursor-help" style={{ color: 'var(--sub-language-text)' }} />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded border text-[11px] leading-snug shadow-lg" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>Ảnh bìa ngang (.avif, .webp, hoặc .jpg) lưu tại items/&lt;slug&gt;/cover_image/cover_landscape.avif (or .webp, .jpg)</span>
              </span>
            </div>
            {addCoverLandscape && (
              <>
                <input id="cover-landscape-file" type="file" accept="image/jpeg,image/webp,image/avif" onChange={e => setHasCoverLandscapeFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
                <div className="text-[11px] typography-inter-4 break-words" style={{ color: 'var(--neutral)' }}>Path: items/{filmId || 'your_slug'}/cover_image/cover_landscape.avif (or .webp, .jpg)</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Episode 1 meta (number locked) */}
      <div className="admin-panel space-y-4">
        <div className="typography-inter-1 admin-panel-title">Episode 1</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm flex items-center gap-1">
              <span className="whitespace-nowrap">Episode Num</span>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 cursor-help" style={{ color: 'var(--sub-language-text)' }} />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded border text-[11px] leading-snug shadow-lg" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
                  This page only creates Episode 1. To add more episodes, use the Add Episode page. The episode number is locked here.
                </span>
              </span>
            </label>
            <input type="number" min={1} className="admin-input opacity-50 cursor-not-allowed pointer-events-none" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--sub-language-text)', borderColor: 'var(--border)' }} value={1} disabled readOnly aria-disabled="true" />
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
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
              <input
                id="chk-ep-cover"
                type="checkbox"
                checked={addEpCover}
                onChange={e => setAddEpCover(e.target.checked)}
                disabled={contentType === 'video' && !videoHasImages}
              />
              <label htmlFor="chk-ep-cover" className={`cursor-pointer whitespace-nowrap ${(contentType === 'video' && !videoHasImages) ? 'opacity-60' : ''}`}>
                Add Cover Landscape (Episode)
                {(contentType === 'video' && !videoHasImages) && <span className="text-red-500 ml-1">*</span>}
              </label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 cursor-help" style={{ color: 'var(--sub-language-text)' }} />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded border text-[11px] leading-snug shadow-lg" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
                  {(contentType === 'video' && !videoHasImages)
                    ? 'Ảnh bìa ngang cho tập (BẮT BUỘC với Video không có ảnh). Sẽ dùng làm image cho tất cả cards trong episode này.'
                    : 'Ảnh bìa ngang cho tập lưu tại items/&lt;slug&gt;/episodes/&lt;slug&gt;_&lt;num&gt;/cover/cover.jpg'}
                </span>
              </span>
            </div>
            {(addEpCover || (contentType === 'video' && !videoHasImages)) && (
              <>
                <input
                  id="ep-cover-file"
                  type="file"
                  accept="image/jpeg,image/webp,image/avif"
                  onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)}
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full"
                  style={{ borderColor: 'var(--primary)' }}
                />
                <div className="text-[11px] typography-inter-4 break-words" style={{ color: 'var(--neutral)' }}>Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3, '0')}/cover/cover.avif (or .webp, .jpg)</div>
                {(contentType === 'video' && !videoHasImages && !hasEpCoverFile) && (
                  <div className="text-xs text-red-500">⚠️ Bắt buộc upload Episode Cover Landscape cho Video content không có ảnh</div>
                )}
              </>
            )}
            {(contentType === 'video' && !videoHasImages && !addEpCover) && (
              <div className="text-xs text-red-500">⚠️ Episode Cover Landscape là bắt buộc cho Video content không có ảnh</div>
            )}
          </div>

        </div>
      </div>

      {/* CSV */}
      <div className="admin-panel space-y-3">
        <div className="typography-inter-1 admin-panel-title">Cards CSV</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onPickCsv} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border" style={{ borderColor: 'var(--primary)' }} />
          <button type="button" title="Refresh / Re-import CSV" onClick={() => { if (csvRef.current) { csvRef.current.value = ""; csvRef.current.click(); } }} className="admin-btn secondary flex items-center gap-1">
            <RefreshCcw className="w-4 h-4" />
            <span className="text-xs">Refresh</span>
          </button>
          <button type="button" className="admin-btn" onClick={() => {
            const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
            // Note: Framework level columns (cefr, jlpt, hsk, etc.) are NOT included in template
            // because they will be ignored - auto assessment will override them
            const headers = ["start", "end", mainCanon, "difficulty_score"]; // type optional
            const sample = [
              ["13.75", "24.602", "Once upon a time", "40"],
              ["24.603", "27.209", "Her name was Ella.", "35"],
            ];
            const csv = [headers.join(","), ...sample.map(r => r.join(","))].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `template_${mainCanon}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }}>Download template</button>
        </div>
        {csvFileName && <div className="text-xs typography-inter-4" style={{ color: 'var(--neutral)' }}>{csvFileName}</div>}
        {csvHeaders.length > 0 && mainLangHeaderOptions.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <label style={{ color: 'var(--text)' }}>Main Language column ({langLabel(mainLanguage)}):</label>
            <select
              className="admin-input !py-1 !px-2 max-w-xs"
              value={mainLangHeaderOverride || mainLangHeaderOptions[0]}
              onChange={e => setMainLangHeaderOverride(e.target.value)}
            >
              {mainLangHeaderOptions.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-xs typography-inter-4" style={{ color: 'var(--neutral)' }}>Prefers non-CC by default</span>
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
          <div className="mt-3 p-3 rounded-lg border space-y-2" style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>⚠️ Xác nhận cột có thể là ngôn ngữ hoặc cột hệ thống:</div>
            {ambiguousHeaders.map(col => {
              const colLower = col.toLowerCase();
              const isId = colLower === 'id';
              const isIn = colLower === 'in';
              const isNo = colLower === 'no';
              const isConfirmed = confirmedAsLanguage.has(col);
              const getLanguageName = () => {
                if (isId || isIn) return 'Indonesian';
                if (isNo) return 'Norwegian';
                return '';
              };
              const getSystemColumnName = () => {
                if (isId) return 'ID';
                if (isIn) return 'hệ thống';
                if (isNo) return 'number';
                return 'hệ thống';
              };
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
                    <span className="font-semibold" style={{ color: 'var(--warning)' }}>"{col}"</span>
                    {isConfirmed ? (
                      <span style={{ color: 'var(--success)' }}> ✓ Được dùng như ngôn ngữ {getLanguageName()}</span>
                    ) : (
                      <span style={{ color: 'var(--sub-language-text)' }}> → Sẽ bị bỏ qua (cột {getSystemColumnName()})</span>
                    )}
                    <div className="text-xs typography-inter-4 mt-0.5" style={{ color: 'var(--neutral)' }}>
                      {isId && "Tick để dùng như ngôn ngữ Indonesian (id), bỏ trống để ignore như cột ID."}
                      {isIn && "Tick để dùng như ngôn ngữ Indonesian (in), bỏ trống để ignore như cột hệ thống."}
                      {isNo && "Tick để dùng như ngôn ngữ Norwegian (no), bỏ trống để ignore như cột number."}
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reference Data Status */}
      {mainLanguage && (() => {
        const framework = getFrameworkFromLanguage(mainLanguage);
        if (!framework) {
          return (
            <div className="admin-panel space-y-3">
              <div className="typography-inter-1 admin-panel-title">Auto Level Assessment</div>
              <div className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-5 h-5 text-yellow-400" />
                  <span className="font-semibold" style={{ color: 'var(--warning)' }}>
                    No Framework Support
                  </span>
                </div>
                <div className="text-sm space-y-1" style={{ color: 'var(--text)' }}>
                  <div>⚠️ Ngôn ngữ "{langLabel(mainLanguage)}" ({mainLanguage}) không có framework tương ứng trong mapping.</div>
                  <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                    Auto level assessment sẽ không chạy cho ngôn ngữ này. Hãy chọn ngôn ngữ khác có framework hỗ trợ (English → CEFR, Japanese → JLPT, Chinese → HSK, Korean → TOPIK, etc.).
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Only show panel if framework exists in mapping
        return (
          <div className="admin-panel space-y-3">
            <div className="typography-inter-1 admin-panel-title">Auto Level Assessment</div>
            {checkingReferenceData ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking reference data availability in database...</span>
              </div>
            ) : referenceDataStatus && referenceDataStatus.framework === framework ? (
              <div className={`p-3 rounded-lg border ${referenceDataStatus.exists ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {referenceDataStatus.exists ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-yellow-400" />
                  )}
                  <span className="font-semibold" style={{ color: referenceDataStatus.exists ? 'var(--success)' : 'var(--warning)' }}>
                    {getFrameworkDisplayName(framework)}
                  </span>
                </div>
                {referenceDataStatus.exists ? (
                  <div className="text-sm space-y-1" style={{ color: 'var(--text)' }}>
                    <div>✓ Frequency data available in database</div>
                    {referenceDataStatus.hasFrequencyData && <div className="text-xs">• Frequency lookup data imported ({framework})</div>}
                    <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                      Auto level assessment will run automatically after content import using frequency ranks and cutoff thresholds.
                    </div>
                  </div>
                ) : (
                  <div className="text-sm space-y-1" style={{ color: 'var(--text)' }}>
                    <div>⚠ No frequency data found in database</div>
                    <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                      Framework {getFrameworkDisplayName(framework)} is supported, but no frequency data exists in database. Please import frequency JSON file for {framework} in Level Management before creating content.
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg border bg-gray-500/10 border-gray-500/30">
                <div className="text-sm" style={{ color: 'var(--text)' }}>
                  Framework {getFrameworkDisplayName(framework)} is supported. Checking database for reference data...
                </div>
              </div>
            )}
            {csvFrameworkLevelIgnored.length > 0 && (
              <div className="p-3 rounded-lg border bg-blue-500/10 border-blue-500/30">
                <div className="text-sm font-semibold mb-1" style={{ color: 'var(--info)' }}>
                  Framework level columns will be ignored:
                </div>
                <div className="text-xs space-y-1" style={{ color: 'var(--text)' }}>
                  {csvFrameworkLevelIgnored.map((col, idx) => (
                    <div key={idx}>• {col} (auto assessment will override)</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Card Media */}
      <CardMediaFiles
        imageFiles={imageFiles}
        audioFiles={audioFiles}
        onPickImages={onPickImages}
        onPickAudio={onPickAudio}
        csvRowsCount={csvRows.length}
        infer={infer}
        setInfer={setInfer}
        padDigits={padDigits}
        setPadDigits={setPadDigits}
        startIndex={startIndex}
        setStartIndex={setStartIndex}
        replaceMode={replaceMode}
        setReplaceMode={setReplaceMode}
        hideImages={contentType === 'video' && !videoHasImages}
      />

      {/* Actions + Progress */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          {!user && <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>}
          <button className="admin-btn primary" disabled={busy || !canCreate} onClick={onCreateAll} title={!isAdmin ? "Requires allowed admin email + key" : undefined}>{busy ? "Processing..." : "Create Content"}</button>
          {busy && stage !== 'done' && (
            <button type="button" className="admin-btn danger" onClick={requestStop} title="Cancel current upload/import">Stop</button>
          )}
          <div className="text-xs typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Stage: {stage}</div>
        </div>
        {(busy || stage === "done") && (
          <ProgressPanel
            stage={stage}
            progress={(() => {
              const isVideo = contentType === 'video';
              const videoNoImages = isVideo && !videoHasImages;
              let totalSteps = 0;
              let completedSteps = 0;
              if (addCover && hasCoverFile) { totalSteps++; if (coverDone > 0) completedSteps++; }
              if (addCoverLandscape && hasCoverLandscapeFile) { totalSteps++; if (coverLandscapeDone > 0) completedSteps++; }
              // For video without images: only count audio, skip images
              // For video with images or other types: count both images and audio
              if (!videoNoImages) totalSteps += imagesTotal;
              totalSteps += audioTotal;
              if (!videoNoImages) completedSteps += imagesDone;
              completedSteps += audioDone;
              totalSteps++;
              if (importDone) completedSteps++;
              if ((addEpCover || videoNoImages) && hasEpCoverFile) { totalSteps++; if (epCoverDone > 0) completedSteps++; }
              totalSteps++;
              if (statsDone) completedSteps++;
              return totalSteps === 0 ? 0 : (completedSteps === totalSteps ? 100 : Math.min(99, Math.floor((completedSteps / totalSteps) * 100)));
            })()}
            items={[
              ...(addCover && hasCoverFile ? [{ label: '1. Cover Portrait', done: coverDone > 0, pending: stage === 'cover' || (busy && coverDone === 0) }] : []),
              ...(addCoverLandscape && hasCoverLandscapeFile ? [{ label: '2. Cover Landscape', done: coverLandscapeDone > 0, pending: stage === 'cover_landscape' || (busy && coverLandscapeDone === 0) }] : []),
              ...((contentType !== 'video' || videoHasImages) ? [{ label: '3. Images', done: imagesTotal > 0 && imagesDone >= imagesTotal, pending: busy && imagesDone < imagesTotal, value: `${imagesDone}/${imagesTotal}` }] : []),
              { label: (contentType === 'video' && !videoHasImages) ? '3. Audio' : ((contentType === 'video' && videoHasImages) ? '4. Audio' : '4. Audio'), done: audioTotal > 0 && audioDone >= audioTotal, pending: busy && audioDone < audioTotal, value: `${audioDone}/${audioTotal}` },
              { label: (contentType === 'video' && !videoHasImages) ? '4. Import CSV' : ((contentType === 'video' && videoHasImages) ? '5. Import CSV' : '5. Import CSV'), done: importDone, pending: stage === 'import', value: importDone ? 'Done' : stage === 'import' ? 'Running' : 'Waiting' },
              ...((addEpCover || (contentType === 'video' && !videoHasImages)) && hasEpCoverFile ? [{ label: (contentType === 'video' && !videoHasImages) ? '5. Episode Cover' : '6. Episode Cover', done: epCoverDone > 0, pending: stage === 'ep_cover' || (importDone && epCoverDone === 0) }] : []),
              { label: (contentType === 'video' && !videoHasImages) ? '6. Calculating Stats' : ((contentType === 'video' && videoHasImages) ? '6. Calculating Stats' : '7. Calculating Stats'), done: statsDone, pending: stage === 'calculating_stats', value: statsDone ? 'Done' : stage === 'calculating_stats' ? 'Running' : 'Waiting' },
              { label: '8. Auto Level Assessment', done: stage === 'done' || stage === 'assessing_levels', pending: stage === 'assessing_levels', value: (stage === 'done' || stage === 'assessing_levels') ? 'Done' : 'Waiting' }
            ]}
          />
        )}
      </div>
      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deletionProgress && setConfirmStop(false)}>
          <div className="rounded-xl p-6 max-w-md w-full mx-4" style={{ backgroundColor: '#16111f', border: '3px solid #ec4899', boxShadow: '0 0 0 2px rgba(147,51,234,0.25) inset, 0 0 24px rgba(236,72,153,0.35)' }} onClick={e => e.stopPropagation()}>
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
              <div className="mb-4 p-3 rounded-lg border-2" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--primary)' }}>
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
