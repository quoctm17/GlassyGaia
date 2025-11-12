import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetFilm, apiFetchCardsForFilm } from '../../services/cfApi';
import type { FilmDoc, CardDoc } from '../../types';
import { langLabel, countryCodeForLang } from '../../utils/lang';
import { ExternalLink } from 'lucide-react';

export default function AdminContentDetailPage() {
  const { contentSlug } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<FilmDoc | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [episodeId, setEpisodeId] = useState<string>('e1');
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
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
    if (!contentSlug || !episodeId) return;
    let mounted = true;
    (async () => {
      setLoadingCards(true);
      try {
        const cardRows = await apiFetchCardsForFilm(contentSlug, episodeId);
        if (!mounted) return;
        setCards(cardRows);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingCards(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeId]);

  const totalEpisodes = item?.episodes || 1;
  const episodeOptions = Array.from({ length: totalEpisodes }, (_, i) => `e${i + 1}`);
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

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Content: {contentSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate('/admin/content')}>← Back</button>
      </div>
      {loadingItem && <div className="admin-info">Loading content...</div>}
      {error && <div className="admin-error">{error}</div>}
      {item && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded p-4 space-y-2">
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
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm">Episode:</label>
        <select className="admin-input" style={{ maxWidth: 140 }} value={episodeId} onChange={e => setEpisodeId(e.target.value)}>
          {episodeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <button className="admin-btn" disabled={loadingCards} onClick={() => setEpisodeId(ep => ep)}>Refresh Cards</button>
      </div>

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Start</th>
              <th>End</th>
              <th>Sentence</th>
              <th>CEFR</th>
              <th>Image</th>
              <th>Audio</th>
            </tr>
          </thead>
          <tbody>
            {cards.map(c => (
              <tr key={c.id} onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/${episodeId}/${c.id}`)} style={{ cursor: 'pointer' }}>
                <td>{c.id}</td>
                <td>{c.start}</td>
                <td>{c.end}</td>
                <td className="admin-cell-ellipsis" title={c.sentence || ''}>{c.sentence || ''}</td>
                <td>{c.CEFR_Level || ''}</td>
                <td>{c.image_url ? <a href={c.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Image</a> : '-'}</td>
                <td>{c.audio_url ? <a href={c.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Audio</a> : '-'}</td>
              </tr>
            ))}
            {cards.length === 0 && !loadingCards && (
              <tr><td colSpan={7} className="admin-empty">No cards found for episode {episodeId}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
