import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { importFilmFromCsv, type ImportFilmMeta } from '../../services/importer';
import { apiGetFilm, apiListEpisodes, apiUpdateEpisodeMeta } from '../../services/cfApi';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia, uploadMediaBatch } from '../../services/storageUpload';
import type { MediaType } from '../../services/storageUpload';
import { canonicalizeLangCode } from '../../utils/lang';

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
  const [addEpCover, setAddEpCover] = useState(false);
  const [addEpAudio, setAddEpAudio] = useState(false);
  const [addEpVideo, setAddEpVideo] = useState(false);

  // CSV & cards media
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  // (Unused) warnings placeholder removed to satisfy lint
  const [csvValid, setCsvValid] = useState<boolean|null>(null);
  const csvRef = useRef<HTMLInputElement|null>(null);

  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);

  // Progress
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('idle');
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [epFullAudioDone, setEpFullAudioDone] = useState(0);
  const [epFullVideoDone, setEpFullVideoDone] = useState(0);
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [importDone, setImportDone] = useState(false);


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
        }
  } catch { /* ignore episodes list errors */ }
    }
    load();
    return () => { cancelled = true; };
  }, [contentSlug]);

  // CSV helpers
  // (Removed lowerHeaderMap; direct headerMap constructed in validateCsv)
  // Required originals are only used for cell highlighting in full ingest UI; not needed here
  // const requiredOriginals = useMemo(() => ['start','end','sentence','type'].map(k => lowerHeaderMap[k]).filter(Boolean) as string[], [lowerHeaderMap]);

  const validateCsv = useCallback((headers: string[], rows: Record<string,string>[]) => {
  const errors: string[] = []; const headerMap: Record<string,string> = {};
    headers.forEach(h => { const l=(h||'').toLowerCase(); if(!headerMap[l]) headerMap[l]=h; });
    // Updated 2025-11: 'sentence' no longer required (auto-derived from main language subtitle), 'type' optional.
    const required = ['start','end'];
    const missing = required.filter(r => !headerMap[r]);
    if (missing.length) errors.push(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
    const mainCanon = canonicalizeLangCode(filmMainLang) || filmMainLang;
    const detected = new Set<string>();
    headers.forEach(h => { const key=(h||'').trim().toLowerCase().replace(/\s+\(.*\)$/,''); if (key===mainCanon) detected.add(mainCanon); });
    if (!detected.has(mainCanon)) errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon}`);
    let ec=0; const maxErr=50; rows.forEach((row,i)=>{ required.forEach(k=>{ const orig=headerMap[k]; const v=orig? (row[orig]||'').trim() : ''; if(!v){ errors.push(`Hàng ${i+2}: cột "${k}" trống.`); ec++; } }); if(ec>=maxErr) return; });
  setCsvErrors(errors); setCsvValid(errors.length===0);
  }, [filmMainLang]);

  useEffect(()=>{ if(csvHeaders.length && csvRows.length) validateCsv(csvHeaders,csvRows); }, [csvHeaders,csvRows,validateCsv]);

  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if(!f) return; const text = await f.text(); setCsvText(text); setCsvFileName(f.name);
    try { const parsed = Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:'greedy'}); const headers=(parsed.meta.fields||[]).map(h=>(h||'').trim()); const rows=(parsed.data||[]) as Record<string,string>[]; setCsvHeaders(headers); setCsvRows(rows); if(!rows.length){ setCsvErrors(['CSV không có dữ liệu']); setCsvValid(false);} else validateCsv(headers,rows);} catch { setCsvErrors(['Lỗi đọc CSV']); setCsvValid(false);} }

  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => setImageFiles(Array.from(e.target.files||[]));
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => setAudioFiles(Array.from(e.target.files||[]));

  // Upload helpers
  const doUploadEpisodeCover = async () => {
    if(!addEpCover) return; const file=(document.getElementById('ep-cover-file') as HTMLInputElement)?.files?.[0]; if(!file) return;
    setStage('ep_cover'); const key=await uploadEpisodeCoverImage({ filmId: contentSlug!, episodeNum, file }); setEpCoverDone(1);
    try { await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, cover_key: key }); toast.success('Episode cover updated'); } catch { toast.error('Không cập nhật được cover episode'); }
  };
  const doUploadEpisodeFull = async () => {
    const aFile=(document.getElementById('ep-full-audio') as HTMLInputElement)?.files?.[0];
    const vFile=(document.getElementById('ep-full-video') as HTMLInputElement)?.files?.[0];
    if(addEpAudio && aFile){ setStage('ep_full_audio'); const key=await uploadEpisodeFullMedia({ filmId: contentSlug!, episodeNum, type:'audio', file:aFile }); setEpFullAudioDone(1); try{ await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_audio_key: key }); }catch{ toast.error('Audio meta fail'); } }
    if(addEpVideo && vFile){ setStage('ep_full_video'); const key=await uploadEpisodeFullMedia({ filmId: contentSlug!, episodeNum, type:'video', file:vFile }); setEpFullVideoDone(1); try{ await apiUpdateEpisodeMeta({ filmSlug: contentSlug!, episodeNum, full_video_key: key }); }catch{ toast.error('Video meta fail'); } }
  };
  const doUploadMedia = async (type: MediaType, files: File[]) => {
    if(!files.length) return; setStage(type==='image'? 'images':'audio'); await uploadMediaBatch({ filmId: contentSlug!, episodeNum, type, files, padDigits, startIndex, inferFromFilenames: infer }, done => { if(type==='image') setImagesDone(done); else setAudioDone(done); }); toast.success(type==='image'? 'Images uploaded':'Audio uploaded'); };

  const onCreateEpisode = async () => {
    if(!user){ toast.error('Sign in required'); return; }
    if(!isAdmin){ toast.error('Admin access required'); return; }
    if(!contentSlug){ toast.error('Missing content slug'); return; }
    try {
      setBusy(true); setStage('starting'); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false);
      await doUploadEpisodeCover(); await doUploadEpisodeFull(); await doUploadMedia('image', imageFiles); await doUploadMedia('audio', audioFiles);
      if(!csvText){ toast.error('CSV required'); return; }
      setStage('import');
      const totalEpisodesDerived = existingEpisodeNums.has(episodeNum) ? existingEpisodes.length : existingEpisodes.length + 1;
      const filmMeta: ImportFilmMeta = {
        title: filmTitle,
        description: filmDescription,
        language: filmMainLang,
        available_subs: [],
        total_episodes: totalEpisodesDerived,
        episodes: 1,
        episode_title: episodeTitle || undefined,
      };
      let cardIds: string[]|undefined = undefined;
      if(infer){ const all=[...imageFiles, ...audioFiles]; const set=new Set<string>(); all.forEach(f=>{ const m=f.name.match(/(\d+)(?=\.[^.]+$)/); if(m){ const raw=m[1]; const id= raw.length>=padDigits? raw: raw.padStart(padDigits,'0'); set.add(id);} }); if(set.size){ cardIds = Array.from(set).sort((a,b)=> parseInt(a)-parseInt(b)); } }
      await importFilmFromCsv({ filmSlug: contentSlug!, episodeNum, filmMeta, csvText, mode: replaceMode? 'replace':'append', cardStartIndex: startIndex, cardPadDigits: padDigits, cardIds }, () => {});
      setImportDone(true); setStage('done'); toast.success('Episode imported successfully');
    } catch(e){ toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="text-lg">Add Episode for Content: <span className="font-mono text-pink-300">{contentSlug}</span></div>
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
              <li>Card media: ảnh (.jpg) & audio (.mp3) cho từng card.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Episode meta */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Episode Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Num</label>
            <input type="number" min={1} className="admin-input" value={episodeNum} onChange={e => setEpisodeNum(Math.max(1, Number(e.target.value)||1))} />
            {existingEpisodeNums.has(episodeNum) ? <span className="text-[11px] text-yellow-400">Trùng tập</span> : <span className="text-[11px] text-green-400">Mới</span>}
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
            </div>
            {addEpCover && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
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
                <input id="ep-full-audio" type="file" accept="audio/mpeg" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
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
                <input id="ep-full-video" type="file" accept="video/mp4" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
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
          <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onPickCsv} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600" />
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
        {csvValid !== null && (
          <div className={`flex items-start gap-2 text-sm ${csvValid? 'text-green-400':'text-red-400'}`}>{csvValid? 'CSV hợp lệ.' : <div className="space-y-1"><div>CSV cần chỉnh sửa:</div><ul className="list-disc pl-5 text-xs">{csvErrors.map((er,i)=><li key={i}>{er}</li>)}</ul></div>}</div>
        )}
      </div>

      {/* Card Media */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Card Media Files</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Images (.jpg)</div>
            <input type="file" accept="image/jpeg" multiple onChange={onPickImages} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
          </div>
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Audio (.mp3)</div>
            <input type="file" accept="audio/mpeg" multiple onChange={onPickAudio} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
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
          <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}`)}>← Back</button>
          <button className="admin-btn primary" disabled={!isAdmin || busy || csvValid !== true} onClick={onCreateEpisode} title={!isAdmin ? 'Requires allowed admin email + key' : undefined}>{busy? 'Processing...' : 'Create Episode + Cards + Media'}</button>
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === 'done') && (
          <div className="admin-panel text-xs space-y-2">
            <div className="flex justify-between"><span>Episode Cover</span><span>{epCoverDone>0? '✓': addEpCover? '...':'skip'}</span></div>
            <div className="flex justify-between"><span>Full Audio</span><span>{epFullAudioDone>0? '✓': addEpAudio? '...':'skip'}</span></div>
            <div className="flex justify-between"><span>Full Video</span><span>{epFullVideoDone>0? '✓': addEpVideo? '...':'skip'}</span></div>
            <div className="flex justify-between"><span>Images</span><span>{imagesDone}/{imageFiles.length}</span></div>
            <div className="flex justify-between"><span>Audio</span><span>{audioDone}/{audioFiles.length}</span></div>
            <div className="flex justify-between"><span>Import</span><span>{importDone? '✓': stage==='import'? '...' : 'pending'}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
