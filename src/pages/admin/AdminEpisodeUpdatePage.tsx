import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Papa from 'papaparse';
import { apiGetEpisodeDetail, apiUpdateEpisodeMeta, apiGetFilm, apiCalculateStats } from '../../services/cfApi';
import type { EpisodeDetailDoc, FilmDoc } from '../../types';
import toast from 'react-hot-toast';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia, uploadMediaBatch, type MediaType } from '../../services/storageUpload';
import { Loader2, RefreshCcw } from 'lucide-react';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { canonicalizeLangCode, expandCanonicalToAliases, langLabel, countryCodeForLang } from '../../utils/lang';
import { detectSubtitleHeaders, findHeaderForLang as findHeaderUtil, categorizeHeaders } from '../../utils/csvDetection';
import ProgressBar from '../../components/ProgressBar';
import CsvPreviewPanel from '../../components/admin/CsvPreviewPanel';
import '../../styles/components/admin/admin-forms.css';

export default function AdminEpisodeUpdatePage() {
  const { contentSlug, episodeSlug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ep, setEp] = useState<EpisodeDetailDoc | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [film, setFilm] = useState<FilmDoc | null>(null);
  const [filmMainLang, setFilmMainLang] = useState<string>('en');

  // File upload states
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveStage, setSaveStage] = useState<'idle' | 'cover' | 'cover_landscape' | 'audio' | 'video' | 'metadata' | 'done'>('idle');

  // Card media files for full replacement workflow
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  
  // Upload progress for replacement workflow
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [epFullAudioDone, setEpFullAudioDone] = useState(0);
  const [epFullVideoDone, setEpFullVideoDone] = useState(0);
  const [epFullVideoBytesDone, setEpFullVideoBytesDone] = useState(0);
  const [epFullVideoBytesTotal, setEpFullVideoBytesTotal] = useState(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);

  function parseEpisodeNumber(slug: string | undefined): number {
    if (!slug) return 1;
    let n = Number(String(slug).replace(/^e/i, ''));
    if (!n || Number.isNaN(n)) {
      const m = String(slug).match(/_(\d+)$/);
      n = m ? Number(m[1]) : 1;
    }
    return n || 1;
  }

  const episodeNum = parseEpisodeNumber(episodeSlug);

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const f = await apiGetFilm(contentSlug!);
        if (mounted) { 
          setFilm(f); 
          if (f?.main_language) setFilmMainLang(f.main_language);
        }
        const row = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
        if (!mounted) return;
        setEp(row);
        setTitle(row?.title || '');
        setDescription(row?.description || '');
        setIsAvailable(row?.is_available !== false);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeSlug, episodeNum]);

  // ================= CSV Re-import (Cards) =================
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvSubtitleWarnings, setCsvSubtitleWarnings] = useState<string[]>([]);
  const [csvValid, setCsvValid] = useState<boolean | null>(null);
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string>('');
  // Reserved column confirmation state (for ambiguous columns like 'id' which could be Indonesian)
  const [confirmedAsLanguage, setConfirmedAsLanguage] = useState<Set<string>>(new Set());
  const csvRef = useRef<HTMLInputElement | null>(null);
  const SUPPORTED_CANON = useMemo(() => ["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","nb","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","se","ta","te","th","tr","uk","vi","fa","ku","sl","sr","bg"] as const, []);

  const validateCsv = useCallback((headers: string[], rows: Record<string,string>[]) => {
    const errors: string[] = [];
    const headerMap: Record<string,string> = {}; headers.forEach(h=>{ const l=(h||'').toLowerCase(); if(!headerMap[l]) headerMap[l]=h; });
    if (headerMap['sentence']) errors.push("Không được truyền cột 'sentence' trong CSV. Hệ thống sẽ tự động lấy subtitle của Main Language để điền vào.");
    const required = ['start','end']; const missing = required.filter(r=>!headerMap[r]); if(missing.length) errors.push(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
    const aliasMap: Record<string,string> = {}; SUPPORTED_CANON.forEach(c=>{ expandCanonicalToAliases(c).forEach(a=>{ aliasMap[a.toLowerCase()] = c; }); });
    aliasMap['portugese']='pt_pt'; aliasMap['portugese (portugal)']='pt_pt'; aliasMap['portugese (brazil)']='pt_br';
    aliasMap['nb']='nb'; aliasMap['norwegian bokmal']='nb'; aliasMap['norwegian bokmål']='nb'; aliasMap['bokmal']='nb'; aliasMap['bokmål']='nb';
    // Northern Sami and Bulgarian aliases
    aliasMap['northern sami']='se'; aliasMap['sami (northern)']='se'; aliasMap['sami']='se'; aliasMap['se']='se'; aliasMap['sme']='se';
    aliasMap['bulgarian']='bg'; aliasMap['bg']='bg';
    const recognizedSubtitleHeaders = detectSubtitleHeaders(headers, confirmedAsLanguage);
    const norm=(s:string)=>s.trim().toLowerCase();
    const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang; const mainAliases=new Set(expandCanonicalToAliases(mainCanon).map(a=>a.toLowerCase()));
    if(mainCanon==='es_la'){ mainAliases.add('spanish (latin america)'); mainAliases.add('spanish latin america'); }
    else if(mainCanon==='es_es'){ mainAliases.add('spanish (spain)'); mainAliases.add('spanish spain'); }
    else if(mainCanon==='pt_br'){ mainAliases.add('portuguese (brazil)'); mainAliases.add('portugese (brazil)'); mainAliases.add('brazilian portuguese'); }
    else if(mainCanon==='pt_pt'){ mainAliases.add('portuguese (portugal)'); mainAliases.add('portugese (portugal)'); }
    const normStrict=(s:string)=>s.toLowerCase().replace(/[_\s-]/g,'').trim(); const mainAliasesStrict=new Set(Array.from(mainAliases).map(a=>normStrict(a)));
    let hasMain=false; let selectedMainHeader: string | null = null; for(const h of headers){ const hStrict=normStrict(h); if(mainAliasesStrict.has(hStrict)){ hasMain=true; selectedMainHeader = h; break; } const low=norm(h).replace(/\s*\[[^\]]*\]\s*/g,'').trim(); const direct=aliasMap[low]; if(direct===mainCanon){ hasMain=true; selectedMainHeader = h; break; }
      const m2=low.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/); if(m2){ const base=m2[1]; const variant=m2[2]; if(base==='spanish'){ const isSpain=/(spain)/.test(variant); const isLatAm=/(latin\s*america|latam)/.test(variant); if(isSpain && mainCanon==='es_es'){ hasMain=true; break;} if(isLatAm && mainCanon==='es_la'){ hasMain=true; break;} continue; } if(base==='portuguese' || base==='portugese'){ const isBrazil=/(brazil)/.test(variant); const isPortugal=/(portugal)/.test(variant); if(isBrazil && mainCanon==='pt_br'){ hasMain=true; break;} if(isPortugal && mainCanon==='pt_pt'){ hasMain=true; break;} continue; } if(base==='chinese'){ const isTrad=/(trad|traditional|hant|hk|tw|mo)/.test(variant); const isSimp=/(simplified|hans|cn)/.test(variant); if(isTrad && mainCanon==='zh_trad'){ hasMain=true; break;} if(isSimp && mainCanon==='zh'){ hasMain=true; break;} continue; } }
      if(!/\([^)]+\)/.test(low)){ const baseCanon=aliasMap[low]; if(baseCanon===mainCanon){ hasMain=true; break; } }
    }
    if(!hasMain) errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon}`);
    // If user picked an override, prefer that as selected main header
    if (mainLangHeaderOverride) {
      const explicit = headers.find(h => h === mainLangHeaderOverride);
      if (explicit) selectedMainHeader = explicit;
    }
    // Fallback to utility finder if still null
    if (!selectedMainHeader) {
      const fh = findHeaderUtil(headers, filmMainLang, confirmedAsLanguage);
      if (fh) selectedMainHeader = fh;
    }

    let ec=0; const maxErr=50; 
    const emptySubtitleRows: number[] = [];
    const emptyMainLangRows: number[] = [];
    rows.forEach((row,i)=>{ 
      required.forEach(k=>{ 
        const orig=headerMap[k]; 
        const v=orig? (row[orig]||'').trim():''; 
        if(!v){ errors.push(`Hàng ${i+1}: cột "${k}" trống.`); ec++; } 
      }); 
      // Track empty main language and subtitle cells as non-blocking warnings
      if (ec < maxErr) {
        if (selectedMainHeader) {
          const mainVal = (row[selectedMainHeader] || '').toString().trim();
          if (!mainVal) emptyMainLangRows.push(i + 1);
        }
        // Only check subtitle headers that are confirmed or non-ambiguous
        let hasEmptySubtitle = false;
        recognizedSubtitleHeaders.forEach((hdr) => {
          if (selectedMainHeader && hdr === selectedMainHeader) return;
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
    setCsvErrors(errors);
    setCsvWarnings(warnings);
    setCsvSubtitleWarnings(subWarnings);
    setCsvValid(errors.length===0);
  }, [filmMainLang, SUPPORTED_CANON, mainLangHeaderOverride, confirmedAsLanguage]);

  const mainLangHeader = useMemo(()=>findHeaderUtil(csvHeaders, filmMainLang, confirmedAsLanguage), [csvHeaders, filmMainLang, confirmedAsLanguage]);
  
  // Compute ambiguousHeaders for UI display (checkbox prompt)
  const ambiguousHeaders = useMemo(() => {
    if (!csvHeaders.length) return [];
    const recognizedSubtitleHeaders = detectSubtitleHeaders(csvHeaders, confirmedAsLanguage);
    const { ambiguousHeaders: ambiguous } = categorizeHeaders(csvHeaders, confirmedAsLanguage, recognizedSubtitleHeaders);
    return ambiguous;
  }, [csvHeaders, confirmedAsLanguage]);
  
  const lowerHeaderMap = useMemo(() => {
    const m: Record<string, string> = {};
    csvHeaders.forEach(h => { m[(h || "").toLowerCase()] = h; });
    return m;
  }, [csvHeaders]);
  const requiredOriginals = useMemo(() => ["start", "end"].map(k => lowerHeaderMap[k]).filter(Boolean) as string[], [lowerHeaderMap]);
  
  const mainLangHeaderOptions = useMemo(()=>{
    const canon = canonicalizeLangCode(filmMainLang) || filmMainLang;
    const variantGroups: Record<string,string[]> = { es_es:['es_es','es_la'], es_la:['es_es','es_la'], pt_pt:['pt_pt','pt_br'], pt_br:['pt_pt','pt_br'] };
    const targetCanonList = variantGroups[canon] || [canon]; const candidateSet = new Set<string>(); const headerCleanMap = csvHeaders.map(h=>({orig:h, clean:h.toLowerCase().replace(/\[[^\]]*\]/g,'').replace(/[_\s-]/g,'')}));
    targetCanonList.forEach(c=>{ const aliases = expandCanonicalToAliases(c).map(a=>a.toLowerCase().replace(/[_\s-]/g,'')); headerCleanMap.forEach(h=>{ if(aliases.includes(h.clean)) candidateSet.add(h.orig); }); });
    const candidates = Array.from(candidateSet); const mainAliasesNorm = expandCanonicalToAliases(canon).map(a=>a.toLowerCase().replace(/[_\s-]/g,''));
    candidates.sort((a,b)=>{ const aIsMain=mainAliasesNorm.includes(a.toLowerCase().replace(/[_\s-]/g,''))?0:1; const bIsMain=mainAliasesNorm.includes(b.toLowerCase().replace(/[_\s-]/g,''))?0:1; if(aIsMain!==bIsMain) return aIsMain-bIsMain; const aCc=/(\[(?:cc)\]|\(cc\))/i.test(a)?1:0; const bCc=/(\[(?:cc)\]|\(cc\))/i.test(b)?1:0; return aCc-bCc; });
    return candidates;
  }, [csvHeaders, filmMainLang]);

  useEffect(()=>{ if(!mainLangHeaderOptions.length){ setMainLangHeaderOverride(''); return; } if(mainLangHeaderOverride && mainLangHeaderOptions.includes(mainLangHeaderOverride)) return; const canon = canonicalizeLangCode(filmMainLang) || filmMainLang; const aliasNorms = new Set(expandCanonicalToAliases(canon).map(a=>a.toLowerCase().replace(/[_\s-]/g,''))); const matching = mainLangHeaderOptions.find(h=>aliasNorms.has(h.toLowerCase().replace(/[_\s-]/g,''))); setMainLangHeaderOverride(matching || mainLangHeaderOptions[0]); }, [mainLangHeaderOptions, filmMainLang, mainLangHeaderOverride]);
  useEffect(()=>{ if(csvHeaders.length && csvRows.length) validateCsv(csvHeaders, csvRows); }, [csvHeaders, csvRows, validateCsv]);

  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if(!f) return; const text = await f.text(); setCsvText(text); setCsvFileName(f.name);
    // Reset confirmed language columns when new file is loaded
    setConfirmedAsLanguage(new Set());
    try { const parsed = Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:'greedy'}); const headers=(parsed.meta.fields||[]).map(h=>(h||'').trim()); const rows=(parsed.data||[]) as Record<string,string>[]; setCsvHeaders(headers); setCsvRows(rows); if(!rows.length){ setCsvErrors(['CSV không có dữ liệu hàng nào.']); setCsvValid(false); } else { validateCsv(headers, rows); } } catch { setCsvErrors(['Lỗi đọc CSV.']); setCsvValid(false); }
  };
  const canReimport = useMemo(() => {
    const csvOk = csvValid === true && !!csvRows.length;
    const cardMediaOk = imageFiles.length > 0 && audioFiles.length > 0;
    return csvOk && cardMediaOk && !loading;
  }, [csvValid, csvRows.length, imageFiles.length, audioFiles.length, loading]);
  const [reimportBusy, setReimportBusy] = useState(false);
  const [reimportStage, setReimportStage] = useState<'idle'|'deleting'|'uploading_media'|'uploading_episode_media'|'import'|'stats'|'done'>('idle');
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [deletionPercent, setDeletionPercent] = useState(0);
  const onCancelReimport = () => {
    // Show confirmation modal
    setConfirmRollback(true);
  };

  const handleReimportCards = async () => {
    if(!contentSlug){ toast.error('Missing content slug'); return; }
    if(!canReimport){ toast.error('CSV and card media files required'); return; }
    
    console.log('[handleReimportCards] Starting replace for episode:', episodeNum);
    
    try {
      setReimportBusy(true);
      cancelRequestedRef.current = false;
      uploadAbortRef.current = new AbortController();
      
      // Reset progress counters
      setImagesDone(0); setAudioDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
      setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
      
      // Skip episode deletion - preserve episode and media
      // Use mode='replace' in importFilmFromCsv to only update cards
      setDeletionPercent(100);
      toast('Giữ nguyên episode và media, chỉ thay thế cards', { icon: 'ℹ️' });
      
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      
      // Step 2: Upload card media (images and audio)
      setReimportStage('uploading_media');
      const doUploadMedia = async (type: MediaType, files: File[], signal?: AbortSignal) => {
        if (!files.length) return;
        await uploadMediaBatch({
          filmId: contentSlug!,
          episodeNum,
          type,
          files,
          padDigits,
          startIndex,
          inferFromFilenames: infer,
          signal
        }, done => {
          if (type === 'image') setImagesDone(done);
          else setAudioDone(done);
        });
        if (!(signal && signal.aborted)) {
          toast.success(type === 'image' ? 'Images uploaded' : 'Audio uploaded');
        }
      };
      
      await Promise.all([
        doUploadMedia('image', imageFiles, uploadAbortRef.current!.signal),
        doUploadMedia('audio', audioFiles, uploadAbortRef.current!.signal)
      ]);
      
      if (cancelRequestedRef.current || uploadAbortRef.current?.signal.aborted) throw new Error('User cancelled');
      
      // Step 3: Import CSV to create new episode and cards
      setReimportStage('import');
      const filmMeta: ImportFilmMeta = {
        title: film?.title || contentSlug!,
        description: film?.description || undefined,
        cover_url: film?.cover_url || undefined,
        language: filmMainLang,
        available_subs: film?.available_subs || [],
        episodes: film?.episodes || 1,
        total_episodes: film?.total_episodes || film?.episodes || 1,
        episode_title: title || undefined,
        is_original: film?.is_original ?? true,
      };
      
      // Infer card IDs if needed
      let cardIds: string[]|undefined = undefined;
      if(infer){ 
        const all=[...imageFiles, ...audioFiles]; 
        const set=new Set<string>(); 
        all.forEach(f=>{ 
          const m=f.name.match(/(\d+)(?=\.[^.]+$)/); 
          if(m){ 
            const raw=m[1]; 
            const id= raw.length>=padDigits? raw: raw.padStart(padDigits,'0'); 
            set.add(id);
          } 
        }); 
        if(set.size){ cardIds = Array.from(set).sort((a,b)=> parseInt(a)-parseInt(b)); } 
      }
      
      // Build confirmed ambiguous language header map (e.g., 'id'/'in' → Indonesian)
      const confirmedMap: Record<string, string> = {};
      confirmedAsLanguage.forEach((hdr) => {
        const low = hdr.trim().toLowerCase();
        if (low === 'id' || low === 'in') confirmedMap['id'] = hdr;
      });
      await importFilmFromCsv({ 
        filmSlug: contentSlug!, 
        episodeNum, 
        filmMeta, 
        csvText, 
        mode: 'replace', 
        cardStartIndex: startIndex, 
        cardPadDigits: padDigits, 
        cardIds, 
        overrideMainSubtitleHeader: mainLangHeaderOverride || undefined,
        confirmedLanguageHeaders: Object.keys(confirmedMap).length ? confirmedMap : undefined,
      }, () => {});
      
      toast.success('CSV imported successfully');
      
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      
      // Step 4: Upload episode-level media (cover, audio, video) if user provided files
      setReimportStage('uploading_episode_media');
      
      // Upload cover if provided
      if (coverFile) {
        try {
          const key = await uploadEpisodeCoverImage({ filmId: contentSlug!, episodeNum, file: coverFile });
          setEpCoverDone(1);
          await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, cover_key: key });
          toast.success('Episode cover uploaded');
        } catch (e) {
          console.error('Cover upload failed:', e);
        }
      }
      
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      
      // Upload full audio if provided
      if (audioFile) {
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug!, episodeNum, type: 'audio', file: audioFile });
          setEpFullAudioDone(1);
          await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_audio_key: key });
          toast.success('Episode full audio uploaded');
        } catch (e) {
          console.error('Full audio upload failed:', e);
        }
      }
      
      if (cancelRequestedRef.current) throw new Error('User cancelled');
      
      // Upload full video if provided
      if (videoFile) {
        try {
          setEpFullVideoBytesDone(0);
          setEpFullVideoBytesTotal(videoFile.size);
          const key = await uploadEpisodeFullMedia({ 
            filmId: contentSlug!, 
            episodeNum, 
            type: 'video', 
            file: videoFile,
            onProgress: (done, total) => { 
              setEpFullVideoBytesDone(done); 
              setEpFullVideoBytesTotal(total); 
            }
          });
          setEpFullVideoDone(1);
          await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_video_key: key });
          toast.success('Episode full video uploaded');
        } catch (e) {
          console.error('Full video upload failed:', e);
        }
      }
      
      // Step 5: Calculate statistics
      setReimportStage('stats');
      try { 
        const statsRes = await apiCalculateStats({ filmSlug: contentSlug!, episodeNum }); 
        if ('error' in statsRes) {
          console.warn('Stats calculation failed:', statsRes.error);
        }
      } catch (statsErr) { 
        console.warn('Stats error:', statsErr);
      }
      
      setReimportStage('done');
      toast.success('Episode replaced successfully!');
      
      // Refresh episode data
      try {
        const refreshed = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
        setEp(refreshed);
        setTitle(refreshed?.title || '');
      } catch { /* ignore refresh errors */ }
      
    } catch (e) {
      const msg = (e as Error).message || '';
      const wasCancelled = /cancelled/i.test(msg);
      if (wasCancelled) {
        toast('Đã hủy tiến trình');
      } else {
        toast.error('Replace failed: ' + msg);
      }
      setReimportStage('idle');
      setDeletionPercent(0);
    } finally { 
      setReimportBusy(false); 
    }
  };

  const handleSave = async () => {
    if (!contentSlug) return;
    setSaving(true);
    setSaveStage('idle');
    setSaveProgress(0);
    
    try {
      let coverUrl = ep?.cover_url;
      let audioUrl = ep?.full_audio_url;
      let videoUrl = ep?.full_video_url;

      // Calculate total steps
      const totalSteps = (coverFile ? 1 : 0) + (audioFile ? 1 : 0) + (videoFile ? 1 : 0) + 1; // +1 for metadata
      let completedSteps = 0;

      // Upload portrait cover if selected
      if (coverFile) {
        setSaveStage('cover');
        setUploadingCover(true);
        try {
          const key = await uploadEpisodeCoverImage({ filmId: contentSlug, episodeNum, file: coverFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          coverUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          completedSteps++;
          setSaveProgress(Math.floor((completedSteps / totalSteps) * 100));
          toast.success('Cover uploaded');
        } catch (e) {
          toast.error(`Cover upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingCover(false);
        }
      }

      // Upload audio if selected
      if (audioFile) {
        setSaveStage('audio');
        setUploadingAudio(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'audio', file: audioFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          audioUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          completedSteps++;
          setSaveProgress(Math.floor((completedSteps / totalSteps) * 100));
          toast.success('Audio uploaded');
        } catch (e) {
          toast.error(`Audio upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingAudio(false);
        }
      }

      // Upload video if selected
      if (videoFile) {
        setSaveStage('video');
        setUploadingVideo(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'video', file: videoFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          videoUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          completedSteps++;
          setSaveProgress(Math.floor((completedSteps / totalSteps) * 100));
          toast.success('Video uploaded');
        } catch (e) {
          toast.error(`Video upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingVideo(false);
        }
      }

      // Update episode metadata
      setSaveStage('metadata');
      await apiUpdateEpisodeMeta({
        filmSlug: contentSlug,
        episodeNum,
        title: title || undefined,
        description: description || undefined,
        cover_url: coverUrl || undefined,
        full_audio_url: audioUrl || undefined,
        full_video_url: videoUrl || undefined,
        is_available: isAvailable ? 1 : 0,
      });
      completedSteps++;
      setSaveProgress(100);
      setSaveStage('done');
      
      toast.success('Episode updated successfully');
      // Refresh episode data to show updated values
      const refreshed = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
      setEp(refreshed);
      setTitle(refreshed?.title || '');
      setDescription(refreshed?.description || '');
      setIsAvailable(refreshed?.is_available !== false);
      // Clear file inputs
      setCoverFile(null);
      setAudioFile(null);
      setVideoFile(null);
      
      // Reset progress after a short delay
      setTimeout(() => {
        setSaveStage('idle');
        setSaveProgress(0);
      }, 2000);
    } catch (e) {
      toast.error((e as Error).message);
      setSaveStage('idle');
      setSaveProgress(0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="text-lg">Admin: Update Episode</div>

      <div className="admin-section-header">
        <h2 className="admin-title">Update Episode: {episodeSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${episodeSlug}`)}>← Back</button>
      </div>

      {/* Quick Guide */}
      {ep && (
        <div className="admin-panel space-y-3">
          <div className="text-sm font-semibold">Hướng dẫn nhanh</div>
          <div className="admin-subpanel text-xs space-y-3">
            <div className="text-gray-300 font-semibold">A) Cập nhật Media (Save)</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li><span className="text-gray-300">Save</span>: Chỉ cập nhật media của episode (Cover, Full Audio, Full Video) mà không thay đổi cards.</li>
              <li><span className="text-gray-300">Title</span>: Tiêu đề của episode.</li>
              <li><span className="text-gray-300">Cover Image</span>: Ảnh bìa episode (.jpg).</li>
              <li><span className="text-gray-300">Full Audio</span>: File audio đầy đủ (.mp3 hoặc .wav).</li>
              <li><span className="text-gray-300">Full Video</span>: File video đầy đủ (.mp4).</li>
              <li className="text-yellow-400">Lưu ý: Save chỉ cập nhật những file bạn chọn, không ảnh hưởng đến cards hiện tại.</li>
            </ul>
            <div className="text-gray-300 font-semibold">B) Thay thế toàn bộ Episode (Replace Episode)</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li><span className="text-gray-300">Replace Episode</span>: Xóa toàn bộ episode cũ (cards + media), sau đó tạo lại episode mới với CSV và media mới.</li>
              <li><span className="text-gray-300">CSV</span>: Cột bắt buộc: <code>start</code>, <code>end</code>. Phải có cột phụ đề cho Main Language (<span className="text-pink-300">{filmMainLang}</span>).</li>
              <li><span className="text-gray-300">Card Media Files</span>: Images (.jpg) và Audio (.mp3/.wav) cho cards (bắt buộc).</li>
              <li><span className="text-gray-300">Infer IDs</span>: Tự động lấy số từ tên file làm card ID. Nếu tắt, dùng Pad Digits + Start Index.</li>
              <li><span className="text-gray-300">Episode Media</span> (tuỳ chọn): Cover, Full Audio, Full Video sẽ được upload sau khi import CSV thành công.</li>
              <li className="text-red-400">Cảnh báo: Replace Episode sẽ XÓA TẤT CẢ cards và media cũ. Hành động này KHÔNG THỂ HOÀN TÁC.</li>
              <li className="text-yellow-400">Nếu cần rollback: Nhấn Stop trong quá trình upload và chọn OK để xóa episode đã tạo.</li>
            </ul>
            <div className="text-[10px] text-gray-500 italic space-y-1">
              <div>Main Language hiện tại: <span className="text-pink-300">{langLabel(filmMainLang)} ({filmMainLang})</span></div>
              <div>CSV phải có cột phụ đề tương ứng (vd: <code>en</code>, <code>vi</code>, <code>ja</code>, v.v.).</div>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="admin-info">Loading…</div>}
      {error && <div className="admin-error">{error}</div>}
      {ep && (
        <div className="admin-panel space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Episode</label>
              <input className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none" value={episodeSlug} disabled readOnly />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Title</label>
              <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Episode title" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Description</label>
              <input 
                className="admin-input" 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                placeholder="Episode description"
              />
            </div>

            <div className="pt-2 border-t border-pink-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Status:</span>
                  <span className={`px-3 py-0.5 rounded-full text-xs font-semibold border ${
                    isAvailable ? 'bg-green-600/20 text-green-300 border-green-500/60' : 'bg-red-600/20 text-red-300 border-red-500/60'
                  }`}>
                    {isAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <button
                  type="button"
                  className="admin-btn secondary !py-1 !px-3 text-xs"
                  onClick={() => setIsAvailable(!isAvailable)}
                >
                  Toggle to {isAvailable ? 'Unavailable' : 'Available'}
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {isAvailable ? 'Episode xuất hiện trong kết quả search' : 'Episode bị ẩn khỏi search'}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="w-40 text-sm">Cover Image (Portrait)</label>
              <div className="space-y-2">
                {ep.cover_url && (
                  <div className="text-xs text-gray-400">
                    Current: <a href={ep.cover_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="image/jpeg" 
                  onChange={(e) => setCoverFile(e.target.files?.[0] || null)} 
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
                />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/cover/cover.jpg</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className="w-40 text-sm">Full Audio</label>
            <div className="space-y-2">
              {ep.full_audio_url && (
                <div className="text-xs text-gray-400">
                  Current: <a href={ep.full_audio_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                </div>
              )}
              <input 
                type="file" 
                accept="audio/mpeg,audio/wav" 
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)} 
                className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
              />
              <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/full/audio.mp3</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="w-40 text-sm">Full Video</label>
            <div className="space-y-2">
              {ep.full_video_url && (
                <div className="text-xs text-gray-400">
                  Current: <a href={ep.full_video_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                </div>
              )}
              <input 
                type="file" 
                accept="video/mp4" 
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)} 
                className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
              />
              <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/full/video.mp4</div>
            </div>
          </div>
        </div>          <div className="flex items-center gap-3 justify-end">
            <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${episodeSlug}`)}>Cancel</button>
            <button
              className="admin-btn primary flex items-center gap-2"
              disabled={saving || uploadingCover || uploadingAudio || uploadingVideo}
              onClick={handleSave}
            >
              {(saving || uploadingCover || uploadingAudio || uploadingVideo) && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>

          {/* Save Progress Display */}
          {(saving || saveStage === 'done') && (
            <div className="admin-panel text-xs space-y-2 mt-4">
              <div className="text-sm font-semibold text-pink-300 mb-2">Upload Progress</div>
              {coverFile && (
                <div className="flex justify-between">
                  <span>Cover Image</span>
                  <span>{saveStage === 'done' || (saveStage !== 'idle' && saveStage !== 'cover') ? '✓' : saveStage === 'cover' ? '...' : 'pending'}</span>
                </div>
              )}
              {audioFile && (
                <div className="flex justify-between">
                  <span>Full Audio</span>
                  <span>{saveStage === 'done' || (saveStage === 'video' || saveStage === 'metadata') ? '✓' : saveStage === 'audio' ? '...' : (saveStage === 'cover' || saveStage === 'cover_landscape' || !coverFile) ? 'waiting' : 'pending'}</span>
                </div>
              )}
              {videoFile && (
                <div className="flex justify-between">
                  <span>Full Video</span>
                  <span>{saveStage === 'done' || saveStage === 'metadata' ? '✓' : saveStage === 'video' ? '...' : 'waiting'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Update Metadata</span>
                <span>{saveStage === 'done' ? '✓' : saveStage === 'metadata' ? '...' : 'waiting'}</span>
              </div>
              <div className="mt-2"><ProgressBar percent={saveProgress} /></div>
            </div>
          )}
        </div>
      )}

      {/* Full Episode Replacement Section - Separate Panel */}
      {ep && (
        <div className="admin-panel space-y-4">
          <div className="text-sm font-semibold">Replace Episode Cards</div>
          <div className="text-xs text-gray-400 mb-3">
            Hệ thống sẽ <span className="text-pink-300">giữ nguyên episode</span> và chỉ <span className="text-yellow-400">thay thế cards</span> (xóa cards cũ, import cards mới từ CSV).
            <br />Episode media (Cover, Full Audio/Video) sẽ được <span className="text-green-400">cập nhật</span> nếu bạn chọn file mới, hoặc <span className="text-blue-400">giữ nguyên</span> nếu không upload.
          </div>

          {/* Fixed Main Language Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Main Language</label>
              <div className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none flex items-center gap-2">
                <span className={`fi fi-${countryCodeForLang(filmMainLang)}`}></span>
                <span>{langLabel(filmMainLang)} ({canonicalizeLangCode(filmMainLang) || filmMainLang})</span>
              </div>
            </div>
          </div>

          {/* CSV Upload */}
          <div className="admin-subpanel space-y-3">
            <div className="text-sm font-semibold">Cards CSV</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onPickCsv} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500" />
              <button type="button" title="Refresh / Re-import CSV" onClick={() => { if (csvRef.current) { csvRef.current.value=''; csvRef.current.click(); } }} className="admin-btn secondary flex items-center gap-1">
                <RefreshCcw className="w-4 h-4" /><span className="text-xs">Refresh</span>
              </button>
              <button type="button" className="admin-btn" onClick={() => {
                const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang;
                const headers = ['start','end',mainCanon,'difficulty_score'];
                const sample = [ ['0.0','2.5',`Sample ${langLabel(mainCanon)}`,'42'] ];
                const csv = [headers.join(','), ...sample.map(r=>r.join(','))].join('\n');
                const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`episode_${episodeNum}_template_${mainCanon}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
              }}>Download template</button>
            </div>
            {csvFileName && <div className="text-xs text-gray-500">{csvFileName}</div>}
            {csvHeaders.length > 0 && mainLangHeaderOptions.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <label className="text-gray-300">Main Language column ({langLabel(filmMainLang)}):</label>
                <select className="admin-input !py-1 !px-2 max-w-xs" value={mainLangHeaderOverride || mainLangHeaderOptions[0]} onChange={e=>setMainLangHeaderOverride(e.target.value)}>
                  {mainLangHeaderOptions.map(h=> <option key={h} value={h}>{h}</option>)}
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

          {/* Card Media Files */}
          <div className="admin-subpanel space-y-3">
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
                <div className="text-xs text-gray-400 mb-2">Images (.jpg) - {imageFiles.length} selected</div>
                <input type="file" accept="image/jpeg" multiple onChange={(e) => setImageFiles(Array.from(e.target.files||[]))} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
              </div>
              <div className="admin-subpanel">
                <div className="text-xs text-gray-400 mb-2">Audio (.mp3 / .wav) - {audioFiles.length} selected</div>
                <input type="file" accept="audio/mpeg,audio/wav" multiple onChange={(e) => setAudioFiles(Array.from(e.target.files||[]))} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
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
                <div className="flex items-center gap-2">
                  <input id="infer-ids" type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} />
                  <label htmlFor="infer-ids" className="text-sm select-none">Infer IDs from filenames</label>
                </div>
              </div>
            </div>
          </div>

          {/* Replace Action */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-center">
              <button type="button" className="admin-btn primary" disabled={!canReimport || reimportBusy} onClick={handleReimportCards}>
                {reimportBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{reimportBusy ? 'Processing…' : 'Replace Episode'}</span>
              </button>
              {reimportBusy && reimportStage !== 'done' && (
                <button type="button" className="admin-btn danger" onClick={onCancelReimport} title="Cancel current upload/import">Stop</button>
              )}
              <div className="text-xs text-gray-400">Stage: {reimportStage}</div>
            </div>
            {(reimportBusy || reimportStage === 'done') && (
              <div className="admin-panel text-xs space-y-2">
                <div className="flex justify-between">
                  <span>1. Delete Old Episode</span>
                  <span>
                    {reimportStage !== 'idle' && reimportStage !== 'deleting'
                      ? '✓'
                      : reimportStage === 'deleting' && deletionPercent > 0
                        ? `${Math.min(100, deletionPercent)}%`
                        : reimportStage === 'deleting'
                          ? '...'
                          : 'pending'}
                  </span>
                </div>
                <div className="flex justify-between"><span>2. Images</span><span>{imagesDone}/{imageFiles.length}</span></div>
                <div className="flex justify-between"><span>3. Audio</span><span>{audioDone}/{audioFiles.length}</span></div>
                <div className="flex justify-between">
                  <span>4. Import CSV</span>
                  <span>{reimportStage === 'stats' || reimportStage === 'done' ? '✓' : reimportStage === 'import' ? '...' : (imagesDone === imageFiles.length && audioDone === audioFiles.length ? 'waiting' : 'pending')}</span>
                </div>
                {coverFile && (
                  <ProgressItem label="5. Episode Cover" done={epCoverDone > 0} pending={reimportStage === 'uploading_episode_media' && epCoverDone === 0} />
                )}
                {audioFile && (
                  <ProgressItem label="6. Episode Full Audio" done={epFullAudioDone > 0} pending={reimportStage === 'uploading_episode_media' && epFullAudioDone === 0} />
                )}
                {videoFile && (
                  <div className="flex justify-between">
                    <span>7. Episode Full Video</span>
                    <span>
                      {epFullVideoDone > 0
                        ? '✓'
                        : reimportStage === 'uploading_episode_media' && epFullVideoBytesTotal > 0
                          ? `${Math.min(100, Math.round((epFullVideoBytesDone / epFullVideoBytesTotal) * 100))}%`
                          : (reimportStage === 'stats' || reimportStage === 'done' ? 'waiting' : 'pending')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>8. Calculating Stats</span>
                  <span>{reimportStage === 'done' ? '✓' : reimportStage === 'stats' ? '...' : (reimportStage === 'uploading_episode_media' || reimportStage === 'import' ? 'waiting' : 'pending')}</span>
                </div>
                {/* Progress bar */}
                {(() => {
                  let totalSteps = 0;
                  let completedSteps = 0;

                  // 1. Delete old episode
                  totalSteps++;
                  if (reimportStage !== 'idle' && reimportStage !== 'deleting') completedSteps++;

                  // 2-3. Card media (images + audio)
                  totalSteps += imageFiles.length + audioFiles.length;
                  completedSteps += imagesDone + audioDone;

                  // 4. Import CSV (required)
                  totalSteps++;
                  if (reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media') completedSteps++;

                  // 5-8. Episode-level media (optional)
                  if (coverFile) {
                    totalSteps++;
                    if (epCoverDone > 0) completedSteps++;
                  }
                  if (audioFile) {
                    totalSteps++;
                    if (epFullAudioDone > 0) completedSteps++;
                  }
                  if (videoFile) {
                    totalSteps++;
                    if (epFullVideoDone > 0) completedSteps += 1;
                    else if (reimportStage === 'uploading_episode_media' && epFullVideoBytesTotal > 0) {
                      completedSteps += Math.max(0, Math.min(1, epFullVideoBytesDone / epFullVideoBytesTotal));
                    }
                  }

                  // 8. Calculate Stats (required)
                  totalSteps++;
                  if (reimportStage === 'done') completedSteps++;

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
      )}

      {/* Custom Rollback Confirmation Modal */}
      {confirmRollback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmRollback(false)}>
          <div 
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận dừng quá trình</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có muốn dừng quá trình Replace Episode?</p>
            <p className="text-sm text-[#e9d5ff] mb-4">Stage hiện tại: <span className="text-[#f9a8d4] font-semibold">{reimportStage}</span></p>
            {(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import') && (
              <p className="text-sm text-[#fbbf24] mb-4">⚠️ Import đã hoàn thành hoặc đang tiến hành.</p>
            )}
            <p className="text-sm text-[#e9d5ff] mb-6">
              Rollback không khả dụng. Hãy chọn \"Hủy\" để dừng tiến trình hoặc refresh trang.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="admin-btn secondary"
                onClick={() => {
                  setConfirmRollback(false);
                  cancelRequestedRef.current = true;
                  try { uploadAbortRef.current?.abort(); } catch (err) { void err; }
                  setReimportStage('idle');
                  setImagesDone(0); setAudioDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
                  setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
                  setReimportBusy(false);
                  toast('Đã hủy tiến trình');
                }}
              >
                Hủy
              </button>
              <button
                className="admin-btn primary"
                onClick={() => setConfirmRollback(false)}
              >
                Đóng
              </button>
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

