import { useEffect, useState } from 'react';
import { apiFetchAllCards, apiFetchCardsForFilm } from '../../services/cfApi';
import type { CardDoc } from '../../types';

export default function AdminMediaPage() {
  const [rows, setRows] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filmFilter, setFilmFilter] = useState<string>('');
  const [episodeFilter, setEpisodeFilter] = useState<string>('');
  // Cover upload removed from list page; now lives on media upload page.
  // navigation removed since Add actions were removed

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const cards = await apiFetchAllCards(200);
        if (!mounted) return;
        setRows(cards);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onApplyFilter = async () => {
    setLoading(true);
    setError(null);
    try {
      if (filmFilter.trim()) {
        const ep = episodeFilter.trim() || undefined;
        const cards = await apiFetchCardsForFilm(filmFilter.trim(), ep);
        setRows(cards);
      } else {
        const cards = await apiFetchAllCards(200);
        setRows(cards);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Cover upload logic removed.

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Media</h2>
      </div>
      <div className="admin-info">This list shows media linked from cards in the database.</div>
      <div className="admin-filters" style={{ marginBottom: 12 }}>
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ minWidth: 60 }}>Film ID</label>
          <input className="admin-input" style={{ maxWidth: 280 }} value={filmFilter} onChange={(e) => setFilmFilter(e.target.value)} placeholder="god_of_gamblers_2" />
          <label style={{ minWidth: 70 }}>Episode</label>
          <input className="admin-input" style={{ width: 90 }} value={episodeFilter} onChange={(e) => setEpisodeFilter(e.target.value)} placeholder="e1" />
          <button className="admin-btn" onClick={onApplyFilter} disabled={loading}>Refresh</button>
        </div>
      </div>

      <div className="admin-table-wrapper" style={{ marginBottom: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Card ID</th>
              <th>Film</th>
              <th>Episode</th>
              <th>Image</th>
              <th>Audio</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id + ':' + r.episode}>
                <td>{r.id}</td>
                <td className="admin-cell-ellipsis" title={r.film_id}>{r.film_id}</td>
                <td>{r.episode}</td>
                <td>{r.image_url ? <a href={r.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary">Image</a> : '-'}</td>
                <td>{r.audio_url ? <a href={r.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary">Audio</a> : '-'}</td>
                <td>{r.start}</td>
                <td>{r.end}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={7} className="admin-empty">No media found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cover upload moved to /admin/media/upload */}
      {error && <div className="admin-error">{error}</div>}
    </div>
  );
}
