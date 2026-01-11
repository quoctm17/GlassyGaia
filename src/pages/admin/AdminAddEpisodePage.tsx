import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { apiGetFilm, apiListEpisodes, apiUpdateEpisodeMeta, apiCalculateStats, apiDeleteEpisode, apiAssessContentLevel, apiCheckReferenceData } from '../../services/cfApi';
import { uploadEpisodeCoverImage, uploadMediaBatch } from '../../services/storageUpload';
import type { MediaType } from '../../services/storageUpload';
import { canonicalizeLangCode, langLabel, expandCanonicalToAliases } from '../../utils/lang';
import { detectSubtitleHeaders, categorizeHeaders } from '../../utils/csvDetection';
import { getFrameworkFromLanguage, getFrameworkDisplayName } from '../../utils/frameworkMapping';
import ProgressBar from '../../components/ProgressBar';
import LanguageTag from '../../components/LanguageTag';
import { Loader2, CheckCircle, RefreshCcw, AlertTriangle, Film, Clapperboard, Book as BookIcon, AudioLines, Video, XCircle } from 'lucide-react';
import { CONTENT_TYPE_LABELS } from '../../types/content';
import type { ContentType } from '../../types/content';
import CsvPreviewPanel from '../../components/admin/CsvPreviewPanel';
import CardMediaFiles from '../../components/admin/CardMediaFiles';
import ProgressPanel from '../../components/admin/ProgressPanel';
import '../../styles/components/admin/admin-forms.css';

// Page to add a new Episode (>=2) to an existing Content Item
export default function AdminAddEpisodePage() {
  const { contentSlug } = useParams();
  const navigate = useNavigate();
  const { user, adminKey, isAdmin: checkIsAdmin } = useUser();
  const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
  const requireKey = !!pass;
  const isAdmin = !!user && checkIsAdmin() && (!requireKey || adminKey === pass);
  
  // Existing film meta
  const [filmMainLang, setFilmMainLang] = useState('en');
  const [filmTitle, setFilmTitle] = useState('');
  const [filmDescription, setFilmDescription] = useState('');
  const [filmType, setFilmType] = useState<string>('');
  const [videoHasImages, setVideoHasImages] = useState(true); // Video-specific: whether video has individual card images
  const [existingEpisodes, setExistingEpisodes] = useState<Array<{ episode_number: number; title: string | null }>>([]);
  const existingEpisodeNums = useMemo(() => new Set(existingEpisodes.map(e => e.episode_number)), [existingEpisodes]);

  // Episode form state
  const [episodeNum, setEpisodeNum] = useState<number>(2); // default next
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDescription, setEpisodeDescription] = useState('');
  const [addEpCover, setAddEpCover] = useState(false);

  // CSV & cards media
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvSubtitleWarnings, setCsvSubtitleWarnings] = useState<string[]>([]);
  const [csvFrameworkLevelIgnored, setCsvFrameworkLevelIgnored] = useState<string[]>([]);
  const [csvValid, setCsvValid] = useState<boolean|null>(null);
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string | null>(null);
  const [confirmedAsLanguage, setConfirmedAsLanguage] = useState<Set<string>>(new Set());
  const csvRef = useRef<HTMLInputElement|null>(null);

  // Reference data check state
  const [referenceDataStatus, setReferenceDataStatus] = useState<{
    framework: string | null;
    exists: boolean;
    hasReferenceList: boolean;
    hasFrequencyData: boolean;
  } | null>(null);
  const [checkingReferenceData, setCheckingReferenceData] = useState(false);

  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [epNumStatus, setEpNumStatus] = useState<'idle' | 'checking' | 'new' | 'duplicate'>('idle');
  const [hasEpCoverFile, setHasEpCoverFile] = useState(false);

  // Progress
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('idle');
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [audioTotal, setAudioTotal] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [statsDone, setStatsDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);
  const importSucceededRef = useRef<boolean>(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);
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
          setFilmType(film.type || '');
          // Load video_has_images from film data
          // video_has_images = true = has individual card images
          // video_has_images = false = uses episode cover for all cards
          if (film.type === 'video') {
            // API returns boolean, default to true if undefined
            setVideoHasImages(film.video_has_images !== false);
          } else {
            setVideoHasImages(true); // Reset when not video
          }
        }
      } catch { /* ignore film fetch errors */ }
      try {
        const eps = await apiListEpisodes((contentSlug || '').trim());
        if (!cancelled) {
          setExistingEpisodes(eps.map(r => ({ episode_number: r.episode_number, title: r.title })));
          const next = eps.length ? Math.max(...eps.map(e => e.episode_number)) + 1 : 2;
          setEpisodeNum(next);
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
    
    // Use shared subtitle detection utility
    const recognizedSubtitleHeaders = detectSubtitleHeaders(headers, confirmedAsLanguage);
    
    // Language detection with alias support
    const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang;
    // Use user-selected override if present; otherwise auto-detect
    const foundHeader = mainLangHeaderOverride ? headers.find(h => h === mainLangHeaderOverride) : findHeaderForLang(headers, filmMainLang);
    if (!foundHeader) {
      errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon} (có thể dùng "${mainCanon}" hoặc tên đầy đủ như "English", "Vietnamese", v.v.)`);
    }
    
    let ec=0; const maxErr=50;
    const emptySubtitleRows: number[] = [];
    const emptyMainLangRows: number[] = [];
    rows.forEach((row,i)=>{
      required.forEach(k=>{
        const orig=headerMap[k];
        const v=orig? (row[orig]||'').trim() : '';
        if(!v){ errors.push(`Hàng ${i+1}: cột "${k}" trống.`); ec++; }
      });
      // Track empty main language and subtitle cells as non-blocking warnings
      if (ec < maxErr) {
        // Main language cell empty → card will be unavailable
        if (foundHeader) {
          const mainVal = (row[foundHeader] || '').toString().trim();
          if (!mainVal) emptyMainLangRows.push(i + 1);
        }
        // Subtitle empties: only check headers that are confirmed or non-ambiguous
        // This prevents false warnings for ambiguous columns like 'id' before user confirmation
        const selectedMain = foundHeader || null;
        let hasEmptySubtitle = false;
        recognizedSubtitleHeaders.forEach((hdr) => {
          if (selectedMain && hdr === selectedMain) return;
          // Skip ambiguous columns that haven't been confirmed
          const hdrLow = hdr.toLowerCase();
          const isAmbiguous = hdrLow === 'id' || hdrLow === 'in';
          if (isAmbiguous && !confirmedAsLanguage.has(hdr)) return;
          const val = (row[hdr] || "").toString().trim();
          if (!val) { hasEmptySubtitle = true; }
        });
        if (hasEmptySubtitle) emptySubtitleRows.push(i + 1);
      }
      if(ec>=maxErr) return;
    });
    const warnings: string[] = [];
    const subWarnings: string[] = [];
    if (emptyMainLangRows.length > 0) {
      const rowList = emptyMainLangRows.slice(0, 10).join(', ') + (emptyMainLangRows.length > 10 ? '...' : '');
      warnings.push(`${emptyMainLangRows.length} cards thiếu phụ đề cho Main Language (${langLabel(mainCanon)}). Hàng: ${rowList}. Các cards này sẽ mặc định unavailable.`);
    }
    if (emptySubtitleRows.length > 0) {
      const rowList = emptySubtitleRows.slice(0, 10).join(', ') + (emptySubtitleRows.length > 10 ? '...' : '');
      subWarnings.push(`${emptySubtitleRows.length} cards có subtitle trống (hàng: ${rowList}). Các subtitle trống sẽ bị bỏ qua khi upload.`);
    }
    // Framework level columns that will be ignored (auto assessment will override)
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
      "topik", "topik_level", "topik level",
      "delf", "delf_level", "delf level",
      "dele", "dele_level", "dele level",
      "goethe", "goethe_level", "goethe level",
      "testdaf", "testdaf_level", "testdaf level",
      "notes", "tags", "metadata",
      "hiragana", "katakana", "romaji"
    ]);
    const frameworkLevelColumns = new Set([
      "cefr", "cefr level", "cefr_level",
      "jlpt", "jlpt level", "jlpt_level",
      "hsk", "hsk level", "hsk_level",
      "topik", "topik level", "topik_level",
      "delf", "delf level", "delf_level",
      "dele", "dele level", "dele_level",
      "goethe", "goethe level", "goethe_level",
      "testdaf", "testdaf level", "testdaf_level"
    ]);
    const frameworkLevelIgnored: string[] = [];
    for (const h of headers) {
      const raw = (h || '').trim();
      if (!raw) continue;
      const low = raw.toLowerCase();
      if (RESERVED_COLUMNS.has(low)) {
        if (frameworkLevelColumns.has(low)) {
          frameworkLevelIgnored.push(raw);
        }
        continue;
      }
    }
    
    setCsvErrors(errors);
    setCsvWarnings(warnings);
    setCsvSubtitleWarnings(subWarnings);
    setCsvFrameworkLevelIgnored(frameworkLevelIgnored);
    setCsvValid(errors.length===0);
  }, [filmMainLang, mainLangHeaderOverride, confirmedAsLanguage]);

  // Compute ambiguousHeaders for UI display (checkbox prompt)
  const ambiguousHeaders = useMemo(() => {
    if (!csvHeaders.length) return [];
    const recognizedSubtitleHeaders = detectSubtitleHeaders(csvHeaders, confirmedAsLanguage);
    const { ambiguousHeaders: ambiguous } = categorizeHeaders(csvHeaders, confirmedAsLanguage, recognizedSubtitleHeaders);
    return ambiguous;
  }, [csvHeaders, confirmedAsLanguage]);

  useEffect(()=>{ if(csvHeaders.length && csvRows.length) validateCsv(csvHeaders,csvRows); }, [csvHeaders,csvRows,filmMainLang,mainLangHeaderOverride,validateCsv]);

  // Check reference data when main language changes
  useEffect(() => {
    const checkReferenceData = async () => {
      if (!filmMainLang) {
        setReferenceDataStatus(null);
        return;
      }
      
      const framework = getFrameworkFromLanguage(filmMainLang);
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
  }, [filmMainLang]);

  // Reset file flags when toggles are turned off
  useEffect(() => { if (!addEpCover) setHasEpCoverFile(false); }, [addEpCover]);

  // Auto-enable episode cover for video content without images
  useEffect(() => {
    if (filmType === 'video' && !videoHasImages && !addEpCover) {
      setAddEpCover(true);
    }
  }, [filmType, videoHasImages, addEpCover]);

  // Reset videoHasImages when filmType changes away from video
  useEffect(() => {
    if (filmType !== 'video') {
      setVideoHasImages(true); // Reset to default
    }
  }, [filmType]);

  const isVideoContent = filmType === 'video';
  // Derived: can create episode (align with Ingest page expectations)
  const canCreate = useMemo(() => {
    const csvOk = csvValid === true;
    // For video: check videoHasImages to determine requirements
    // For other types: require both image and audio files
    const cardMediaOk = isVideoContent 
      ? (videoHasImages 
          ? (imageFiles.length > 0 && audioFiles.length > 0)
          : audioFiles.length > 0)
      : imageFiles.length > 0 && audioFiles.length > 0;
    // For video without images: episode cover is required (must be checked and have file)
    // For video with images or other types: episode cover is optional
    const epCoverOk = (isVideoContent && !videoHasImages)
      ? (addEpCover && hasEpCoverFile)
      : (!addEpCover || hasEpCoverFile);
    const optionalUploadsOk = epCoverOk;
    return !!(isAdmin && csvOk && cardMediaOk && optionalUploadsOk);
  }, [isAdmin, csvValid, isVideoContent, videoHasImages, imageFiles.length, audioFiles.length, addEpCover, hasEpCoverFile]);

  // Overall progress computation across all tasks (matches AdminContentIngestPage logic)
  useEffect(() => {
    let totalSteps = 0;
    let completedSteps = 0;

    // 1. Card media (images + audio) - use EFFECTIVE totals from uploader (after skips)
    // For video without images: only count audio, skip images
    // For video with images or other types: count both images and audio
    if (!isVideoContent || videoHasImages) totalSteps += imagesTotal;
    totalSteps += audioTotal;
    if (!isVideoContent || videoHasImages) completedSteps += imagesDone;
    completedSteps += audioDone;

    // 2. Import CSV (required)
    totalSteps++;
    if (importDone) completedSteps++;

    // 3. Episode Cover (optional for video with images, required for video without images)
    if ((addEpCover || (isVideoContent && !videoHasImages)) && hasEpCoverFile) {
      totalSteps++;
      if (epCoverDone > 0) completedSteps++;
    }

    // 4. Calculate Stats (required)
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
    hasEpCoverFile,
    epCoverDone,
    statsDone,
    stage,
    progress,
    isVideoContent,
    videoHasImages
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
      setEpCoverDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      // For video: check videoHasImages to determine what to upload
      // For other types: upload both images and audio
      const uploadPromises = (isVideoContent && !videoHasImages)
        ? [doUploadMedia('audio', audioFiles, uploadAbortRef.current!.signal)]
        : [
            doUploadMedia('image', imageFiles, uploadAbortRef.current!.signal),
            doUploadMedia('audio', audioFiles, uploadAbortRef.current!.signal)
          ];
      await Promise.all(uploadPromises);
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
      if(infer){ 
        // For video without images: only use audio files for inferring IDs
        // For video with images or other types: use both image and audio files
        const all = (isVideoContent && !videoHasImages) ? audioFiles : [...imageFiles, ...audioFiles]; 
        const set=new Set<string>(); 
        all.forEach(f=>{ const m=f.name.match(/(\d+)(?=\.[^.]+$)/); if(m){ const raw=m[1]; const id= raw.length>=padDigits? raw: raw.padStart(padDigits,'0'); set.add(id);} }); 
        if(set.size){ cardIds = Array.from(set).sort((a,b)=> parseInt(a)-parseInt(b)); } 
      }
      
      // Build extension maps from uploaded files
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
          const ext = isImage ? (f.type === "image/avif" ? "avif" : (f.type === "image/webp" ? "webp" : "jpg")) : (f.type === "audio/wav" || f.type === "audio/x-wav" ? "wav" : (f.type === "audio/opus" || f.type === "audio/ogg" ? "opus" : "mp3"));
          if (isImage) { imageExtensions[cardId] = ext; } else { audioExtensions[cardId] = ext; }
        });
      };
      // Only build image extension map if video has images or not video type
      if (!isVideoContent || videoHasImages) {
        buildExtMap(imageFiles, true);
      }
      buildExtMap(audioFiles, false);
      
      try {
        // Build confirmed ambiguous language header map (e.g., 'id'/'in' → Indonesian)
        const confirmedMap: Record<string, string> = {};
        confirmedAsLanguage.forEach((hdr) => {
          const low = hdr.trim().toLowerCase();
          if (low === 'id' || low === 'in') confirmedMap['id'] = hdr;
        });
        await importFilmFromCsv({ filmSlug: contentSlug!, episodeNum, filmMeta, csvText, mode: replaceMode? 'replace':'append', cardStartIndex: startIndex, cardPadDigits: padDigits, cardIds, imageExtensions, audioExtensions, overrideMainSubtitleHeader: mainLangHeaderOverride || undefined, confirmedLanguageHeaders: Object.keys(confirmedMap).length ? confirmedMap : undefined, videoHasImages: isVideoContent ? videoHasImages : undefined }, () => {});
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
      // Auto level assessment (always enabled)
      try {
        setStage("assessing_levels");
        toast.loading("Running auto level assessment...", { id: "auto-assessment" });
        await apiAssessContentLevel(contentSlug!, (_progress) => {
          // Progress callback for assessment (currently not used in UI)
        });
        toast.success("Auto level assessment completed", { id: "auto-assessment" });
      } catch (err) {
        console.warn('Auto level assessment failed:', err);
        toast.error("Auto level assessment failed: " + (err as Error).message, { id: "auto-assessment" });
        // Non-blocking error - don't fail the whole import
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
          setEpCoverDone(0);
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
      setEpCoverDone(0);
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
          <div className="typography-inter-1 admin-panel-title">Quick Guide (Add Episode)</div>
          <div className="admin-subpanel typography-inter-4 space-y-3">
            <div style={{ color: 'var(--text)' }} className="font-semibold">A) Các trường nhập</div>
            <ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--sub-language-text)' }}>
              <li><span style={{ color: 'var(--text)' }}>Content Slug</span>: cố định ({contentSlug})</li>
              <li><span style={{ color: 'var(--text)' }}>Episode Num</span>: chọn số tập mới (tránh trùng, sẽ hiện cảnh báo nếu trùng).</li>
              <li><span style={{ color: 'var(--text)' }}>Episode Title</span> và <span style={{ color: 'var(--text)' }}>Episode Description</span> (tuỳ chọn).</li>
              <li><span style={{ color: 'var(--text)' }}>Episode Cover</span> (tuỳ chọn): Ảnh bìa ngang cho tập.</li>
            </ul>
            <div style={{ color: 'var(--text)' }} className="font-semibold">B) CSV cần</div>
            <ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--sub-language-text)' }}>
              <li>Cột bắt buộc: <code>start</code>, <code>end</code>.</li>
              <li>Phải có cột phụ đề cho Main Language ({filmMainLang}).</li>
              <li><code>type</code> tùy chọn; <code>sentence</code> tự động lấy từ phụ đề của Main Language.</li>
            </ul>
            <div style={{ color: 'var(--text)' }} className="font-semibold">C) Card Media Files</div>
            <ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--sub-language-text)' }}>
              <li><strong>Với Type = Video</strong>: Có 2 trường hợp:
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li><strong>Video có ảnh</strong>: Upload cả <strong>Images</strong> (.webp) và <strong>Audio</strong> (.opus) cho từng card (giống các type khác).</li>
                  <li><strong>Video không có ảnh</strong>: Chỉ upload <strong>Audio</strong> (.opus). <strong>Episode Cover Landscape</strong> là bắt buộc (sẽ dùng làm image cho tất cả cards).</li>
                </ul>
              </li>
              <li><strong>Với các Type khác</strong>: Cần upload cả <strong>Images</strong> (.webp) và <strong>Audio</strong> (.opus) cho cards.</li>
              <li><span style={{ color: 'var(--text)' }}>Infer IDs</span>: Tự động lấy số từ tên file làm card ID. Nếu tắt, dùng Pad Digits + Start Index.</li>
            </ul>
            <div className="text-[10px]" style={{ color: 'var(--neutral)', fontStyle: 'italic' }}>
              <div>Main Language hiện tại: <span style={{ color: 'var(--primary)' }}>{langLabel(filmMainLang)} ({filmMainLang})</span></div>
              <div>CSV phải có cột phụ đề tương ứng (vd: <code>en</code>, <code>vi</code>, <code>ja</code>, v.v.).</div>
            </div>
          </div>
        </div>
      )}

      {/* Episode meta */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--sub-language-text)' }}>Episode Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm typography-inter-3" style={{ fontSize: '10px' }}>Main Language</label>
            <div className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none flex items-center gap-2">
              <LanguageTag code={filmMainLang} withName={true} size="md" />
            </div>
          </div>
          {filmType && (
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm typography-inter-3" style={{ fontSize: '10px' }}>Content Type</label>
              <div className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none flex items-center gap-2">
                {filmType === 'movie' && <Film className="w-4 h-4" />}
                {filmType === 'series' && <Clapperboard className="w-4 h-4" />}
                {filmType === 'book' && <BookIcon className="w-4 h-4" />}
                {filmType === 'audio' && <AudioLines className="w-4 h-4" />}
                {filmType === 'video' && <Video className="w-4 h-4" />}
                <span>{CONTENT_TYPE_LABELS[filmType as ContentType] || filmType}</span>
              </div>
            </div>
          )}
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
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Title</label>
            <input className="admin-input" value={episodeTitle} onChange={e => setEpisodeTitle(e.target.value)} placeholder="Optional episode title" />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-2">Episode Description</label>
          <textarea 
            className="admin-input" 
            rows={3}
            value={episodeDescription} 
            onChange={e => setEpisodeDescription(e.target.value)} 
            placeholder="Optional episode description"
          />
        </div>
        {/* Video-specific: display video_has_images setting (read-only) */}
        {filmType === 'video' && (
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Video Images</label>
            <div className="flex items-center gap-3 flex-1">
              <input 
                id="chk-video-images" 
                type="checkbox" 
                checked={videoHasImages} 
                disabled={true}
                style={{ opacity: 0.5, cursor: 'not-allowed' }}
              />
              <label htmlFor="chk-video-images" className="text-xs opacity-60" style={{ color: 'var(--text)' }}>
                {videoHasImages ? 'Video has individual card images' : 'Video uses episode cover for all cards'} <span className="text-gray-400">(read-only from content settings)</span>
              </label>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
              <input 
                id="chk-ep-cover" 
                type="checkbox" 
                checked={addEpCover} 
                onChange={e => setAddEpCover(e.target.checked)}
                disabled={filmType === 'video' && !videoHasImages}
                style={{ flexShrink: 0 }} 
              />
              <label htmlFor="chk-ep-cover" className={`cursor-pointer ${(filmType === 'video' && !videoHasImages) ? 'opacity-60' : ''}`} style={{ lineHeight: '1' }}>
                Add Cover Landscape (Episode)
                {(filmType === 'video' && !videoHasImages) && <span className="text-red-500 ml-1">*</span>}
              </label>
            </div>
            {(addEpCover || (filmType === 'video' && !videoHasImages)) && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg,image/webp,image/avif" onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug + '_' + episodeNum}/cover/cover.avif (or .webp, .jpg)</div>
                {(filmType === 'video' && !videoHasImages && !hasEpCoverFile) && (
                  <div className="text-xs text-red-500">⚠️ Bắt buộc upload Episode Cover Landscape cho Video content không có ảnh</div>
                )}
              </>
            )}
            {(filmType === 'video' && !videoHasImages && !addEpCover) && (
              <div className="text-xs text-red-500">⚠️ Episode Cover Landscape là bắt buộc cho Video content không có ảnh</div>
            )}
          </div>
        </div>
      </div>

      {/* CSV */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold" style={{ color: 'var(--sub-language-text)' }}>Cards CSV</div>
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
          csvSubtitleWarnings={csvSubtitleWarnings}
          confirmedAsLanguage={confirmedAsLanguage}
          requiredOriginals={requiredOriginals}
          mainLangHeader={mainLangHeader}
          mainLangHeaderOverride={mainLangHeaderOverride}
        />
        
        {/* Ambiguous column checkboxes */}
        {ambiguousHeaders.length > 0 && (
          <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/40 rounded-lg space-y-2">
            <div className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>⚠️ Xác nhận cột có thể là ngôn ngữ hoặc cột hệ thống:</div>
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
                    style={{ flexShrink: 0 }}
                  />
                  <label htmlFor={`ambiguous-${col}`} className="cursor-pointer select-none flex-1" style={{ lineHeight: '1.4' }}>
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

      {/* Reference Data Status / Auto Level Assessment */}
      {filmMainLang && (() => {
        const framework = getFrameworkFromLanguage(filmMainLang);
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
                  <div>⚠️ Ngôn ngữ "{langLabel(filmMainLang)}" ({filmMainLang}) không có framework tương ứng trong mapping.</div>
                  <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                    Auto level assessment sẽ không chạy cho ngôn ngữ này. Hãy chọn ngôn ngữ khác có framework hỗ trợ (English → CEFR, Japanese → JLPT, Chinese → HSK, Korean → TOPIK, etc.).
                  </div>
                </div>
              </div>
            </div>
          );
        }

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
                    <div>✓ Reference data available in database</div>
                    {referenceDataStatus.hasReferenceList && <div className="text-xs">• Reference list imported ({framework})</div>}
                    {referenceDataStatus.hasFrequencyData && <div className="text-xs">• Frequency data available ({framework})</div>}
                    <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                      Auto level assessment will run automatically after episode import.
                    </div>
                  </div>
                ) : (
                  <div className="text-sm space-y-1" style={{ color: 'var(--text)' }}>
                    <div>⚠ No reference data found in database</div>
                    <div className="text-xs mt-2" style={{ color: 'var(--neutral)' }}>
                      Framework {getFrameworkDisplayName(framework)} is supported, but no reference data exists in database. Please import reference data for {framework} in Level Management before creating content.
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
        hideImages={isVideoContent && !videoHasImages}
      />

      {/* Actions + Progress */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          <button className="admin-btn primary" disabled={busy || !canCreate} onClick={onCreateEpisode} title={!isAdmin ? 'Requires allowed admin email + key' : undefined}>{busy? 'Processing...' : 'Create Episode'}</button>
          {busy && stage !== 'done' && (
            <button type="button" className="admin-btn danger" onClick={onCancelAll} title="Cancel current upload/import">Stop</button>
          )}
          <div className="text-xs" style={{ color: 'var(--sub-language-text)' }}>Stage: {stage}</div>
        </div>
        {(busy || stage === 'done') && (
          <ProgressPanel
            stage={stage}
            progress={progress}
            items={[
              ...((isVideoContent && !videoHasImages) ? [] : [{ label: '1. Images', done: imagesTotal > 0 && imagesDone >= imagesTotal, pending: busy && imagesDone < imagesTotal, value: `${imagesDone}/${imagesTotal}` }]),
              { label: (isVideoContent && !videoHasImages) ? '1. Audio' : ((isVideoContent && videoHasImages) ? '2. Audio' : '2. Audio'), done: audioTotal > 0 && audioDone >= audioTotal, pending: busy && audioDone < audioTotal, value: `${audioDone}/${audioTotal}` },
              { label: (isVideoContent && !videoHasImages) ? '2. Import CSV' : ((isVideoContent && videoHasImages) ? '3. Import CSV' : '3. Import CSV'), done: importDone, pending: stage === 'import', value: importDone ? 'Done' : stage === 'import' ? 'Running' : 'Waiting' },
              ...((addEpCover || (isVideoContent && !videoHasImages)) && hasEpCoverFile ? [{ label: (isVideoContent && !videoHasImages) ? '3. Episode Cover' : '4. Episode Cover', done: epCoverDone > 0, pending: stage === 'ep_cover' || (importDone && epCoverDone === 0) }] : []),
              { label: (isVideoContent && !videoHasImages) ? ((addEpCover || (isVideoContent && !videoHasImages)) && hasEpCoverFile ? '4. Calculating Stats' : '3. Calculating Stats') : ((isVideoContent && videoHasImages) ? '5. Calculating Stats' : '5. Calculating Stats'), done: statsDone, pending: stage === 'calculating_stats', value: statsDone ? 'Done' : stage === 'calculating_stats' ? 'Running' : 'Waiting' },
              { label: '6. Auto Level Assessment', done: stage === 'done' || stage === 'assessing_levels', pending: stage === 'assessing_levels', value: (stage === 'done' || stage === 'assessing_levels') ? 'Done' : 'Waiting' }
            ]}
          />
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deletionProgress && setConfirmCancel(false)}>
          <div 
            className="rounded-xl p-6 max-w-md w-full mx-4" 
            style={{ backgroundColor: '#16111f', border: '3px solid #ec4899', boxShadow: '0 0 0 2px rgba(147,51,234,0.25) inset, 0 0 24px rgba(236,72,153,0.35)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {deletionProgress ? (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-[#f5d0fe]">Đang rollback...</h3>
                <div className="text-sm text-[#e9d5ff] space-y-2">
                  <div><span className="text-[#f9a8d4] font-semibold">{deletionProgress.stage}</span></div>
                  <div className="text-xs" style={{ color: 'var(--sub-language-text)' }}>{deletionProgress.details}</div>
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
