import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Papa from 'papaparse';
import { apiGetEpisodeDetail, apiUpdateEpisodeMeta, apiGetFilm, apiCalculateStats } from '../../services/cfApi';
import type { EpisodeDetailDoc, FilmDoc } from '../../types';
import toast from 'react-hot-toast';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia } from '../../services/storageUpload';
import { Loader2, RefreshCcw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { canonicalizeLangCode, expandCanonicalToAliases, langLabel } from '../../utils/lang';

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
  const canReimport = csvValid === true && !!csvRows.length && !loading;
  const [reimportBusy, setReimportBusy] = useState(false);
  const [reimportStage, setReimportStage] = useState<'idle'|'import'|'stats'|'done'>('idle');
  const handleReimportCards = async () => {
    if(!contentSlug){ toast.error('Missing content slug'); return; }
    if(!canReimport){ toast.error('CSV chưa hợp lệ'); return; }
    try {
      setReimportBusy(true); setReimportStage('import');
      const filmMeta: ImportFilmMeta = {
        title: film?.title || contentSlug!,
        description: film?.description || undefined,
        cover_url: film?.cover_url || undefined,
        language: filmMainLang,
        available_subs: film?.available_subs || [],
        episodes: film?.episodes || 1,
        total_episodes: film?.total_episodes || film?.episodes || 1,
        episode_title: ep?.title || undefined,
        is_original: film?.is_original ?? true,
      };
      await importFilmFromCsv({ filmSlug: contentSlug!, episodeNum, filmMeta, csvText, mode: 'replace', overrideMainSubtitleHeader: mainLangHeaderOverride || undefined });
      toast.success('Đã thay thế toàn bộ cards từ CSV');
      setReimportStage('stats');
      try { const statsRes = await apiCalculateStats({ filmSlug: contentSlug!, episodeNum }); if ('error' in statsRes) toast.error('Không tính được thống kê sau import'); } catch { /* ignore */ }
      setReimportStage('done');
    } catch (e) {
      toast.error('Re-import failed: ' + (e as Error).message);
      setReimportStage('idle');
    } finally { setReimportBusy(false); }
  };

  const handleSave = async () => {
    if (!contentSlug) return;
    setSaving(true);
    try {
      let coverUrl = ep?.cover_url;
      let audioUrl = ep?.full_audio_url;
      let videoUrl = ep?.full_video_url;

      // Upload cover if selected
      if (coverFile) {
        setUploadingCover(true);
        try {
          const key = await uploadEpisodeCoverImage({ filmId: contentSlug, episodeNum, file: coverFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          coverUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Cover uploaded');
        } catch (e) {
          toast.error(`Cover upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingCover(false);
        }
      }

      // Upload audio if selected
      if (audioFile) {
        setUploadingAudio(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'audio', file: audioFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          audioUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Audio uploaded');
        } catch (e) {
          toast.error(`Audio upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingAudio(false);
        }
      }

      // Upload video if selected
      if (videoFile) {
        setUploadingVideo(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'video', file: videoFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          videoUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Video uploaded');
        } catch (e) {
          toast.error(`Video upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingVideo(false);
        }
      }

      // Update episode metadata
      await apiUpdateEpisodeMeta({
        filmSlug: contentSlug,
        episodeNum,
        title: title || undefined,
        cover_url: coverUrl || undefined,
        full_audio_url: audioUrl || undefined,
        full_video_url: videoUrl || undefined,
      });
      toast.success('Episode updated successfully');
      // Refresh episode data to show updated values
      const refreshed = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
      setEp(refreshed);
      setTitle(refreshed?.title || '');
      // Clear file inputs
      setCoverFile(null);
      setAudioFile(null);
      setVideoFile(null);
    } catch (e) {
      toast.error((e as Error).message);
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

            <div className="flex flex-col gap-2 md:col-span-2">
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
                  accept="audio/mpeg" 
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

          {/* Card Re-import Section */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold">Re-import Cards from CSV (Replace)</div>
            <div className="text-xs text-gray-400">Main Language: <span className="text-pink-300">{langLabel(filmMainLang)} ({filmMainLang})</span></div>
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
              <div className="ml-auto flex items-center gap-2">
                <button type="button" className="admin-btn primary" disabled={!canReimport || reimportBusy} onClick={handleReimportCards}>
                  {reimportBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{reimportBusy ? 'Importing…' : 'Replace Cards'}</span>
                </button>
                {reimportStage === 'done' && <CheckCircle className="w-4 h-4 text-green-400" />}
              </div>
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
        </div>
      )}
    </div>
  );
}
