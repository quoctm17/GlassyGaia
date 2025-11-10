import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetFilm, apiFetchCardsForFilm } from '../../services/cfApi';
import type { FilmDoc, CardDoc } from '../../types';
import { langLabel, countryCodeForLang } from '../../utils/lang';
import { ExternalLink } from 'lucide-react';

export default function AdminFilmDetailPage() {
  const { filmSlug } = useParams();
  const navigate = useNavigate();
  const [film, setFilm] = useState<FilmDoc | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [episodeId, setEpisodeId] = useState<string>('e1');
  const [loadingFilm, setLoadingFilm] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filmSlug) return;
    let mounted = true;
    (async () => {
      setLoadingFilm(true);
      try {
        const f = await apiGetFilm(filmSlug);
        if (!mounted) return;
        setFilm(f);
        // Derive languages list. Prefer available_subs if present; fallback to main_language.
        const subs = Array.isArray(f?.available_subs) ? f!.available_subs.filter(Boolean) : [];
        const langList = subs.length ? subs : (f?.main_language ? [f.main_language] : []);
        setLanguages(langList);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingFilm(false); }
    })();
    return () => { mounted = false; };
  }, [filmSlug]);

  useEffect(() => {
    if (!filmSlug || !episodeId) return;
    let mounted = true;
    (async () => {
      setLoadingCards(true);
      try {
        const cardRows = await apiFetchCardsForFilm(filmSlug, episodeId);
        if (!mounted) return;
        setCards(cardRows);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingCards(false); }
    })();
    return () => { mounted = false; };
  }, [filmSlug, episodeId]);

  const totalEpisodes = film?.episodes || 1;
  const episodeOptions = Array.from({ length: totalEpisodes }, (_, i) => `e${i + 1}`);

  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/$/, '');
  const coverDisplayUrl = useMemo(() => {
    if (!film) return '';
    let url = film.cover_url || '';
    // Nếu worker chưa cấu hình R2_PUBLIC_BASE nên trả về đường dẫn tương đối ('/items/...'), ta ghép base public R2.
    if (url.startsWith('/') && r2Base) {
      url = r2Base + url; // url đã có leading slash
    }
    // Fallback: nếu vẫn chưa có, thử path chuẩn mới.
    if (!url && film.id) {
      const path = `/items/${film.id}/cover_image/cover.jpg`;
      url = r2Base ? r2Base + path : path;
    }
    return url;
  }, [film, r2Base]);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Film: {filmSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate('/admin/films')}>← Back</button>
      </div>
      {loadingFilm && <div className="admin-info">Loading film...</div>}
      {error && <div className="admin-error">{error}</div>}
      {film && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded p-4 space-y-2">
          <div><span className="font-semibold">Title:</span> {film.title || '-'}</div>
          <div>
            <span className="font-semibold">Main Language:</span>{' '}
            {film.main_language ? (
              <span className="inline-flex items-center gap-1">
                <span className={`fi fi-${countryCodeForLang(film.main_language)} w-5 h-3.5`}></span>
                <span>{langLabel(film.main_language)}</span>
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
          <div><span className="font-semibold">Episodes:</span> {Number(film.episodes) > 0 ? film.episodes : 1}</div>
          <div><span className="font-semibold">Total Episodes:</span> {Number(film.total_episodes) > 0 ? film.total_episodes : '-'}</div>
          <div><span className="font-semibold">Description:</span> {film.description || '-'}</div>
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
        <button className="admin-btn" disabled={loadingCards} onClick={() => {
          // force refresh
          setEpisodeId(ep => ep);
        }}>Refresh Cards</button>
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
              <tr key={c.id} onClick={() => navigate(`/admin/films/${encodeURIComponent(filmSlug!)}/${episodeId}/${c.id}`)} style={{ cursor: 'pointer' }}>
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
