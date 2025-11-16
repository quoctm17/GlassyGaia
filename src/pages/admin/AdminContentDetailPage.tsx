import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetFilm, apiListEpisodes } from '../../services/cfApi';
import type { FilmDoc, LevelFrameworkStats } from '../../types';
import { langLabel, countryCodeForLang } from '../../utils/lang';
import { ExternalLink, PlusCircle } from 'lucide-react';

export default function AdminContentDetailPage() {
  const { contentSlug } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<FilmDoc | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState<Array<{ episode_number: number; title: string | null; slug: string; cover_url: string | null; full_audio_url: string | null; full_video_url: string | null }>>([]);
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoadingItem(true);
      try {
        const f = await apiGetFilm(contentSlug); // still film API for content item
        if (!mounted) return;
        setItem(f);
        const subs = Array.isArray(f?.available_subs) ? f!.available_subs.filter(Boolean) : [];
        const langList = subs.length ? subs : (f?.main_language ? [f.main_language] : []);
        setLanguages(langList);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingItem(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug]);

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoadingEpisodes(true);
      try {
        const rows = await apiListEpisodes(contentSlug);
        if (!mounted) return;
        setEpisodes(rows);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingEpisodes(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug]);
  
  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/$/, '');
  const coverDisplayUrl = useMemo(() => {
    if (!item) return '';
    let url = item.cover_url || '';
    if (url.startsWith('/') && r2Base) url = r2Base + url;
    if (!url && item.id) {
      const path = `/items/${item.id}/cover_image/cover.jpg`;
      url = r2Base ? r2Base + path : path;
    }
    return url;
  }, [item, r2Base]);

  function parseLevelStats(raw: unknown): LevelFrameworkStats | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw as LevelFrameworkStats;
    if (typeof raw === 'string') {
      try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr as LevelFrameworkStats : null; } catch { return null; }
    }
    return null;
  }
  const levelStats = useMemo(() => parseLevelStats(item?.level_framework_stats as unknown), [item?.level_framework_stats]);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Content: {contentSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate('/admin/content')}>← Back</button>
      </div>
      {loadingItem && <div className="admin-info">Loading content...</div>}
      {error && <div className="admin-error">{error}</div>}
      {item && (
        <div className="admin-panel mb-4 space-y-2">
          <div><span className="font-semibold">Title:</span> {item.title || '-'}</div>
          <div><span className="font-semibold">Type:</span> {item.type || '-'}</div>
          <div>
            <span className="font-semibold">Main Language:</span>{' '}
            {item.main_language ? (
              <span className="inline-flex items-center gap-1">
                <span className={`fi fi-${countryCodeForLang(item.main_language)} w-5 h-3.5`}></span>
                <span>{langLabel(item.main_language)}</span>
              </span>
            ) : '-'}
          </div>
          <div>
            <span className="font-semibold">Available Subs:</span>{' '}
            {languages.length ? (
              <span className="inline-flex flex-wrap gap-2">
                {languages.map(l => (
                  <span key={l} className="inline-flex items-center gap-1 bg-gray-700/60 px-2 py-0.5 rounded text-xs">
                    <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                    <span>{langLabel(l)}</span>
                  </span>
                ))}
              </span>
            ) : '-'}
          </div>
          <div><span className="font-semibold">Episodes:</span> {Number(item.episodes) > 0 ? item.episodes : 1}</div>
          <div><span className="font-semibold">Total Episodes:</span> {Number(item.total_episodes) > 0 ? item.total_episodes : '-'}</div>
          <div><span className="font-semibold">Description:</span> {item.description || '-'}</div>
          {coverDisplayUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Cover:</span>
                <a href={coverDisplayUrl} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                  <ExternalLink className="w-4 h-4" />
                  Open
                </a>
              </div>
              <img src={coverDisplayUrl} alt="cover" className="w-32 h-auto rounded border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_10px_rgba(236,72,153,0.4)]" />
            </div>
          )}
          {/* Content-level Stats */}
          <div className="pt-2 space-y-2">
            <div><span className="font-semibold">Total Cards:</span> {item.num_cards ?? '-'}</div>
            <div><span className="font-semibold">Avg Difficulty:</span> {typeof item.avg_difficulty_score === 'number' ? item.avg_difficulty_score.toFixed(1) : '-'}</div>
            <div>
              <span className="font-semibold">Level Distribution:</span>
              {levelStats && levelStats.length ? (
                <div className="mt-2 space-y-2">
                  {levelStats.map((entry, idx) => (
                    <div key={idx} className="bg-gray-800/40 rounded p-2">
                      <div className="text-sm text-pink-300">{entry.framework}{entry.language ? ` · ${entry.language}` : ''}</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {Object.entries(entry.levels).map(([lvl, pct]) => (
                          <div key={lvl} className="text-xs bg-gray-700/60 px-2 py-0.5 rounded">
                            <span className="text-gray-300">{lvl}:</span> <span className="text-pink-300">{pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span> -</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        {loadingEpisodes ? <div className="admin-info">Loading episodes…</div> : <div />}
        <div>
          <button className="admin-btn primary flex items-center gap-2" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/add-episode`)}>
            <PlusCircle className="w-4 h-4" />
            <span>Add Episode</span>
          </button>
        </div>
      </div>

      {/* Episodes list */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Cover</th>
              <th>Full Audio</th>
              <th>Full Video</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map(ep => (
              <tr key={ep.slug} onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${ep.slug}`)} style={{ cursor: 'pointer' }}>
                <td>{String(ep.episode_number).padStart(3,'0')}</td>
                <td className="admin-cell-ellipsis" title={ep.title || ''}>{ep.title || '-'}</td>
                <td>{ep.cover_url ? <a href={ep.cover_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
                <td>{ep.full_audio_url ? <a href={ep.full_audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
                <td>{ep.full_video_url ? <a href={ep.full_video_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
              </tr>
            ))}
            {episodes.length === 0 && !loadingEpisodes && (
              <tr><td colSpan={5} className="admin-empty">No episodes found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
