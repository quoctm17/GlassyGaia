import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Papa from 'papaparse';
import { apiGetEpisodeDetail, apiUpdateEpisodeMeta, apiGetFilm, apiCalculateStats, apiDeleteEpisode } from '../../services/cfApi';
import type { EpisodeDetailDoc, FilmDoc } from '../../types';
import toast from 'react-hot-toast';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia, uploadMediaBatch, type MediaType } from '../../services/storageUpload';
import { Loader2, RefreshCcw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { canonicalizeLangCode, expandCanonicalToAliases, langLabel } from '../../utils/lang';
import ProgressBar from '../../components/ProgressBar';

export default function AdminEpisodeUpdatePage() {
  const { contentSlug, episodeSlug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ep, setEp] = useState<EpisodeDetailDoc | null>(null);
  const [title, setTitle] = useState('');
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
  const [saveStage, setSaveStage] = useState<'idle' | 'cover' | 'audio' | 'video' | 'metadata' | 'done'>('idle');

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

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const f = await apiGetFilm(contentSlug!);
        if (mounted) { setFilm(f); if (f?.main_language) setFilmMainLang(f.main_language); }
        const num = parseEpisodeNumber(episodeSlug);
        const row = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum: num });
        if (!mounted) return;
        setEp(row);
        setTitle(row?.title || '');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeSlug]);

  const episodeNum = parseEpisodeNumber(episodeSlug);

  // ================= CSV Re-import (Cards) =================
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvValid, setCsvValid] = useState<boolean | null>(null);
  const [mainLangHeaderOverride, setMainLangHeaderOverride] = useState<string>('');
  const csvRef = useRef<HTMLInputElement | null>(null);
  const SUPPORTED_CANON = useMemo(() => ["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","th","tr","uk","vi","fa","ku","sl","sr","bg"] as const, []);

  const validateCsv = useCallback((headers: string[], rows: Record<string,string>[]) => {
    const errors: string[] = []; const warnings: string[] = [];
    const headerMap: Record<string,string> = {}; headers.forEach(h=>{ const l=(h||'').toLowerCase(); if(!headerMap[l]) headerMap[l]=h; });
    const RESERVED_COLUMNS = new Set([
      'id','card_id','cardid','card id','no','number','card_number','cardnumber','card number',
      'start','start_time','starttime','start time','start_time_ms','end','end_time','endtime','end time','end_time_ms',
      'duration','length','card_length','type','card_type','cardtype','card type','sentence','text','content','image','image_url','imageurl','image url','image_key',
      'audio','audio_url','audiourl','audio url','audio_key','difficulty','difficulty_score','difficultyscore','difficulty score','cefr','cefr_level','cefr level','jlpt','jlpt_level','jlpt level','hsk','hsk_level','hsk level',
      'notes','tags','metadata','hiragana','katakana','romaji'
    ]);
    if (headerMap['sentence']) errors.push("Không được truyền cột 'sentence' trong CSV. Hệ thống sẽ tự động lấy subtitle của Main Language để điền vào.");
    const required = ['start','end']; const missing = required.filter(r=>!headerMap[r]); if(missing.length) errors.push(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
    const aliasMap: Record<string,string> = {}; SUPPORTED_CANON.forEach(c=>{ expandCanonicalToAliases(c).forEach(a=>{ aliasMap[a.toLowerCase()] = c; }); });
    aliasMap['portugese']='pt_pt'; aliasMap['portugese (portugal)']='pt_pt'; aliasMap['portugese (brazil)']='pt_br';
    const recognizedSubtitleHeaders = new Set<string>(); const norm=(s:string)=>s.trim().toLowerCase();
    headers.forEach(h=>{ const rawLow=norm(h); const cleaned=rawLow.replace(/\s*\[[^\]]*\]\s*/g,'').trim(); if(RESERVED_COLUMNS.has(cleaned)) return; if(aliasMap[cleaned]){ recognizedSubtitleHeaders.add(h); return; }
      const m=cleaned.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/); if(m){ const base=m[1]; const variant=m[2]; if(base==='chinese'){ if(/(trad|traditional|hant|hk|tw|mo)/.test(variant)){ recognizedSubtitleHeaders.add(h); return;} if(/(simplified|hans|cn)/.test(variant)){ recognizedSubtitleHeaders.add(h); return;} } if(aliasMap[base]) recognizedSubtitleHeaders.add(h); }
    });
    const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang; const mainAliases=new Set(expandCanonicalToAliases(mainCanon).map(a=>a.toLowerCase()));
    if(mainCanon==='es_la'){ mainAliases.add('spanish (latin america)'); mainAliases.add('spanish latin america'); }
    else if(mainCanon==='es_es'){ mainAliases.add('spanish (spain)'); mainAliases.add('spanish spain'); }
    else if(mainCanon==='pt_br'){ mainAliases.add('portuguese (brazil)'); mainAliases.add('portugese (brazil)'); mainAliases.add('brazilian portuguese'); }
    else if(mainCanon==='pt_pt'){ mainAliases.add('portuguese (portugal)'); mainAliases.add('portugese (portugal)'); }
    const normStrict=(s:string)=>s.toLowerCase().replace(/[_\s-]/g,'').trim(); const mainAliasesStrict=new Set(Array.from(mainAliases).map(a=>normStrict(a)));
    let hasMain=false; for(const h of headers){ const hStrict=normStrict(h); if(mainAliasesStrict.has(hStrict)){ hasMain=true; break; } const low=norm(h).replace(/\s*\[[^\]]*\]\s*/g,'').trim(); const direct=aliasMap[low]; if(direct===mainCanon){ hasMain=true; break; }
      const m2=low.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/); if(m2){ const base=m2[1]; const variant=m2[2]; if(base==='spanish'){ const isSpain=/(spain)/.test(variant); const isLatAm=/(latin\s*america|latam)/.test(variant); if(isSpain && mainCanon==='es_es'){ hasMain=true; break;} if(isLatAm && mainCanon==='es_la'){ hasMain=true; break;} continue; } if(base==='portuguese' || base==='portugese'){ const isBrazil=/(brazil)/.test(variant); const isPortugal=/(portugal)/.test(variant); if(isBrazil && mainCanon==='pt_br'){ hasMain=true; break;} if(isPortugal && mainCanon==='pt_pt'){ hasMain=true; break;} continue; } if(base==='chinese'){ const isTrad=/(trad|traditional|hant|hk|tw|mo)/.test(variant); const isSimp=/(simplified|hans|cn)/.test(variant); if(isTrad && mainCanon==='zh_trad'){ hasMain=true; break;} if(isSimp && mainCanon==='zh'){ hasMain=true; break;} continue; } }
      if(!/\([^)]+\)/.test(low)){ const baseCanon=aliasMap[low]; if(baseCanon===mainCanon){ hasMain=true; break; } }
    }
    if(!hasMain) errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon}`);
    const knownSingles=new Set(['start','end','type','length','cefr','cefr level','cefr_level','jlpt','jlpt level','jlpt_level','hsk','hsk level','hsk_level','difficulty score','difficulty_score','difficultyscore','score','difficulty_percent','card_difficulty']);
    const isFrameworkDynamic=(raw:string)=>{ const key=raw.trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g,''); return /^(?:difficulty|diff)[_:\-/ ]?[a-z0-9]+(?:[_:\-/ ][a-z_]{2,8})?$/i.test(key); };
    const ignored:string[]=[]; for(const h of headers){ const raw=(h||'').trim(); if(!raw) continue; const low=raw.toLowerCase(); if(RESERVED_COLUMNS.has(low)) continue; if(knownSingles.has(low)) continue; if(recognizedSubtitleHeaders.has(raw)) continue; if(isFrameworkDynamic(raw)) continue; if(low==='sentence') continue; ignored.push(raw); }
    if(ignored.length) warnings.push(`Các cột sẽ bị bỏ qua: ${ignored.join(', ')}`);
    let ec=0; const maxErr=50; rows.forEach((row,i)=>{ required.forEach(k=>{ const orig=headerMap[k]; const v=orig? (row[orig]||'').trim():''; if(!v){ errors.push(`Hàng ${i+2}: cột "${k}" trống.`); ec++; } }); if(ec>=maxErr) return; });
    setCsvErrors(errors); setCsvWarnings(warnings); setCsvValid(errors.length===0);
  }, [filmMainLang, SUPPORTED_CANON]);

  function findHeaderForLang(headers: string[], lang: string): string | null {
    const rawAliases = expandCanonicalToAliases(lang); const normalized = rawAliases.map(a=>a.toLowerCase().replace(/[_\s-]/g,'')); const variant = rawAliases.filter(a=>/\(.+\)/.test(a)).map(a=>a.toLowerCase().replace(/[_\s-]/g,'')); const headerNorms = headers.map(h=>({orig:h,norm:h.toLowerCase().replace(/[_\s-]/g,'')}));
    for(const v of variant){ const found=headerNorms.find(h=>h.norm===v); if(found) return found.orig; }
    for(const a of normalized){ const found=headerNorms.find(h=>h.norm===a); if(found) return found.orig; }
    return null;
  }
  const mainLangHeader = useMemo(()=>findHeaderForLang(csvHeaders, filmMainLang), [csvHeaders, filmMainLang]);
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
  const [deletionProgress, setDeletionProgress] = useState<{stage: string; details: string} | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);
  const onCancelReimport = () => {
    // Always show confirmation modal (like AdminContentListPage)
    setConfirmRollback(true);
  };

  const executeRollback = async () => {
    setDeletionPercent(10);
    let timer: number | undefined;
    let slowTimer: number | undefined;
    setDeletionProgress({ stage: 'Đang xóa...', details: 'Đang xử lý yêu cầu xóa episode' });
    try {
      // Phase 1: fast ramp to 70%
      timer = window.setInterval(() => {
        setDeletionPercent((p) => (p < 70 ? p + 4 : p));
      }, 220);
      setTimeout(() => {
        // Phase 2: slower ramp 70% -> 85%
        if (timer) window.clearInterval(timer);
        timer = window.setInterval(() => {
          setDeletionPercent((p) => (p < 85 ? p + 2 : p));
        }, 500);
      }, 3000);
      // Phase 3: indeterminate finalization
      slowTimer = window.setInterval(() => {
        setDeletionPercent((p) => (p >= 85 && p < 95 ? p + 1 : p));
      }, 4000);
      
      setDeletionProgress({ stage: 'Đang xóa database...', details: 'Xóa Cards, subtitles và metadata' });
      const deleteRes = await apiDeleteEpisode({ filmSlug: contentSlug!, episodeNum });
      
      if (timer) window.clearInterval(timer);
      if (slowTimer) window.clearInterval(slowTimer);
      
      if ('error' in deleteRes) {
        toast.error("Rollback episode thất bại: " + deleteRes.error);
        setDeletionProgress(null);
        setDeletionPercent(0);
        return;
      }
      
      setDeletionPercent(100);
      setDeletionProgress({ stage: 'Hoàn tất', details: `Đã xóa ${deleteRes.cards_deleted} cards, ${deleteRes.media_deleted} media files` });
      console.log("✅ Manual rollback: deleted episode", deleteRes.cards_deleted, "cards:", deleteRes.media_deleted, "media");
      
      setTimeout(() => {
        toast.success("Đã rollback thành công");
        setConfirmRollback(false);
        setDeletionProgress(null);
        setDeletionPercent(0);
        // Reset state
        setReimportStage('idle');
        setImagesDone(0); setAudioDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
        setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
        setReimportBusy(false);
      }, 600);
    } catch (err) {
      console.error("Manual rollback error:", err);
      toast.error("Rollback thất bại: " + (err as Error).message);
      setDeletionProgress(null);
      setDeletionPercent(0);
    } finally {
      if (timer) window.clearInterval(timer);
      if (slowTimer) window.clearInterval(slowTimer);
    }
  };

  const handleReimportCards = async () => {
    if(!contentSlug){ toast.error('Missing content slug'); return; }
    if(!canReimport){ toast.error('CSV and card media files required'); return; }
    
    try {
      setReimportBusy(true);
      cancelRequestedRef.current = false;
      uploadAbortRef.current = new AbortController();
      
      // Reset progress counters
      setImagesDone(0); setAudioDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
      setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
      
      // Step 1: Delete old episode and all its media (with progress simulation)
      setReimportStage('deleting');
      setDeletionPercent(10);
      let deleteTimer: number | undefined;
      try {
        // Simulate deletion progress (fast ramp to 70%)
        deleteTimer = window.setInterval(() => {
          setDeletionPercent((p) => (p < 70 ? p + 5 : p < 90 ? p + 2 : p));
        }, 200);
        
        const deleteRes = await apiDeleteEpisode({ filmSlug: contentSlug!, episodeNum });
        
        if (deleteTimer) window.clearInterval(deleteTimer);
        setDeletionPercent(100);
        
        if ('error' in deleteRes) {
          toast.error('Failed to delete old episode: ' + deleteRes.error);
          setDeletionPercent(0);
          return;
        }
        toast.success(`Deleted old episode (Cards: ${deleteRes.cards_deleted}, Media: ${deleteRes.media_deleted})`);
      } catch (delErr) {
        if (deleteTimer) window.clearInterval(deleteTimer);
        setDeletionPercent(0);
        throw delErr;
      }
      
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
      
      await importFilmFromCsv({ 
        filmSlug: contentSlug!, 
        episodeNum, 
        filmMeta, 
        csvText, 
        mode: 'replace', 
        cardStartIndex: startIndex, 
        cardPadDigits: padDigits, 
        cardIds, 
        overrideMainSubtitleHeader: mainLangHeaderOverride || undefined 
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

      // Upload cover if selected
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
        cover_url: coverUrl || undefined,
        full_audio_url: audioUrl || undefined,
        full_video_url: videoUrl || undefined,
      });
      completedSteps++;
      setSaveProgress(100);
      setSaveStage('done');
      
      toast.success('Episode updated successfully');
      // Refresh episode data to show updated values
      const refreshed = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
      setEp(refreshed);
      setTitle(refreshed?.title || '');
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

            <div className="flex flex-col gap-2">
              <label className="w-40 text-sm">Cover Image</label>
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>

          <div className="flex items-center gap-3 justify-end">
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
                  <span>{saveStage === 'done' || (saveStage === 'video' || saveStage === 'metadata') ? '✓' : saveStage === 'audio' ? '...' : (saveStage === 'cover' || !coverFile) ? 'waiting' : 'pending'}</span>
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
          <div className="text-sm font-semibold">Replace Entire Episode (Delete + Recreate)</div>
          <div className="text-xs text-gray-400 mb-3">
            This will delete the current episode and all its media, then create a new episode with fresh data.
            <br />Main Language: <span className="text-pink-300">{langLabel(filmMainLang)} ({filmMainLang})</span>
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
            {csvValid !== null && (
              <div className={`flex items-start gap-2 text-sm ${csvValid? 'text-green-400':'text-red-400'}`}>
                {csvValid ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                <div>{csvValid ? 'CSV hợp lệ.' : <div className="space-y-1"><div>CSV cần chỉnh sửa:</div><ul className="list-disc pl-5 text-xs">{csvErrors.map((er,i)=><li key={i}>{er}</li>)}</ul></div>}</div>
              </div>
            )}
            {csvWarnings.length>0 && csvValid && (
              <div className="flex items-start gap-2 text-xs text-yellow-400"><AlertTriangle className="w-4 h-4" /><ul className="list-disc pl-5">{csvWarnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>
            )}
            {csvHeaders.length>0 && mainLangHeaderOptions.length>1 && (
              <div className="flex items-center gap-2 text-sm">
                <label className="text-gray-300">Main Language column:</label>
                <select className="admin-input !py-1 !px-2 max-w-xs" value={mainLangHeaderOverride || mainLangHeaderOptions[0]} onChange={e=>setMainLangHeaderOverride(e.target.value)}>
                  {mainLangHeaderOptions.map(h=> <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-xs text-gray-500">Chọn cột phụ đề chính</span>
              </div>
            )}
            {csvHeaders.length>0 && (
              <div className="overflow-auto border border-gray-700 rounded max-h-[420px]">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 bg-[#1a0f24] z-10">
                    <tr>
                      <th className="border border-gray-700 px-2 py-1 text-left">#</th>
                      {csvHeaders.map((h,i)=>{ const isRequired=['start','end'].includes(h.toLowerCase()); const selectedMain=(mainLangHeaderOverride || mainLangHeader)===h; return (
                        <th key={i} className={`border border-gray-700 px-2 py-1 text-left ${isRequired || selectedMain ? 'bg-pink-900/30 font-semibold':''}`}>{h}{isRequired && <span className="text-red-400 ml-1">*</span>}{selectedMain && <span className="text-amber-400 ml-1">★</span>}</th>
                      ); })}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((row,i)=>(
                      <tr key={i} className="hover:bg-pink-900/10">
                        <td className="border border-gray-700 px-2 py-1 text-gray-500">{i+1}</td>
                        {csvHeaders.map((h,j)=>{ const val=row[h] || ''; const isRequired=['start','end'].includes(h.toLowerCase()); const selectedMain=(mainLangHeaderOverride || mainLangHeader)===h; const isEmpty=!val.trim(); return (
                          <td key={j} className={`border border-gray-700 px-2 py-1 ${isEmpty && (isRequired || selectedMain) ? 'bg-red-900/20 text-red-300':'text-gray-300'}`}>{val}</td>
                        ); })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[10px] text-gray-500 px-2 py-1"><span className="text-red-400">*</span> Required | <span className="text-amber-400">★</span> Main Language</div>
              </div>
            )}
          </div>

          {/* Card Media Files */}
          <div className="admin-subpanel space-y-3">
            <div className="text-sm font-semibold">Card Media Files</div>
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

                  // 5-7. Episode-level media (optional)
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deletionProgress && setConfirmRollback(false)}>
          <div 
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận dừng quá trình</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có muốn dừng quá trình Replace Episode?</p>
            <p className="text-sm text-[#e9d5ff] mb-4">Stage hiện tại: <span className="text-[#f9a8d4] font-semibold">{reimportStage}</span></p>
            {(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import') && (
              <p className="text-sm text-[#fbbf24] mb-4">⚠️ Import đã hoàn thành hoặc đang tiến hành. Nếu Rollback, toàn bộ Cards và Media đã upload sẽ bị xóa!</p>
            )}
            <p className="text-sm text-[#e9d5ff] mb-6">
              {(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import')
                ? 'Chọn "Chỉ dừng upload" để giữ lại episode đã tạo, hoặc "Rollback" để xóa hoàn toàn.'
                : 'Chọn "Dừng" để hủy quá trình upload ngay lập tức.'}
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
                onClick={() => {
                  if (!deletionProgress) {
                    setConfirmRollback(false);
                    // Just cancel uploads without rollback
                    cancelRequestedRef.current = true;
                    try { uploadAbortRef.current?.abort(); } catch (err) { void err; }
                    setReimportStage('idle');
                    setImagesDone(0); setAudioDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0);
                    setEpFullVideoBytesDone(0); setEpFullVideoBytesTotal(0);
                    setReimportBusy(false);
                    toast('Đã hủy tiến trình');
                  }
                }}
                disabled={!!deletionProgress}
              >
                {(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import')
                  ? 'Chỉ dừng upload'
                  : 'Hủy'}
              </button>
              {(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import') && (
                <button
                  className="admin-btn danger"
                  disabled={!!deletionProgress}
                  onClick={executeRollback}
                >
                  {deletionProgress ? 'Đang xóa...' : 'Rollback'}
                </button>
              )}
              {!(reimportStage === 'stats' || reimportStage === 'done' || reimportStage === 'uploading_episode_media' || reimportStage === 'import') && (
                <button
                  className="admin-btn primary"
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

