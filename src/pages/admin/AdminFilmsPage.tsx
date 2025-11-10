import { useEffect, useState } from 'react';
import { apiListFilms } from '../../services/cfApi';
import type { FilmDoc } from '../../types';
import { useNavigate } from 'react-router-dom';

export default function AdminFilmsPage() {
  const [rows, setRows] = useState<FilmDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const films = await apiListFilms();
        if (!mounted) return;
        setRows(films);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Films</h2>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Title</th>
              <th>Main language</th>
              <th>Release</th>
              <th>Subs</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(f => (
              <tr key={f.id} onClick={() => navigate(`/admin/films/${encodeURIComponent(f.id)}`)} style={{ cursor: 'pointer' }}>
                <td className="admin-cell-ellipsis" title={f.id}>{f.id}</td>
                <td className="admin-cell-ellipsis" title={f.title || ''}>{f.title || '-'}</td>
                <td>{f.main_language || '-'}</td>
                <td>{f.release_year || '-'}</td>
                <td>{(f.available_subs || []).join(', ')}</td>
                <td><button className="admin-btn secondary" onClick={(e) => { e.stopPropagation(); navigate(`/admin/films/${encodeURIComponent(f.id)}`); }}>View</button></td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={6} className="admin-empty">No films found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
