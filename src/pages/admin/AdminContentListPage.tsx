import { useEffect, useState } from 'react';
import { apiListItems } from '../../services/cfApi';
import type { FilmDoc } from '../../types';
import { useNavigate } from 'react-router-dom';
import { canonicalizeLangCode, countryCodeForLang, langLabel } from '../../utils/lang';
import LanguageTag from '../../components/LanguageTag';

export default function AdminContentListPage() {
  const [rows, setRows] = useState<FilmDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const items = await apiListItems();
        if (!mounted) return;
        setRows(items);
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

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Content</h2>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Title</th>
              <th>Type</th>
              <th>Main language</th>
              <th>Release</th>
              <th>Subs</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={7} className="admin-empty">No content found</td>
              </tr>
            )}
            {rows.map((f) => {
              const subs = Array.from(new Set((f.available_subs || []).map(s => canonicalizeLangCode(s) || s.toLowerCase())));
              return (
                <tr key={f.id} onClick={() => navigate(`/admin/content/${encodeURIComponent(f.id)}`)} style={{ cursor:'pointer' }}>
                  <td className="admin-cell-ellipsis" title={f.id}>{f.id}</td>
                  <td className="admin-cell-ellipsis" title={f.title || ''}>{f.title || '-'}</td>
                  <td>{f.type || '-'}</td>
                  <td>{f.main_language ? <LanguageTag code={f.main_language} /> : '-'}</td>
                  <td>{f.release_year || '-'}</td>
                  <td>
                    {subs.length ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {subs.map(s => (
                          <span key={s} className="inline-flex items-center gap-1 bg-gray-700/60 px-2 py-0.5 rounded text-xs">
                            <span className={`fi fi-${countryCodeForLang(s)} w-4 h-3`}></span>
                            <span>{langLabel(s)}</span>
                          </span>
                        ))}
                      </span>
                    ) : '-'}
                  </td>
                  <td>
                    <button className="admin-btn secondary" onClick={(e) => { e.stopPropagation(); navigate(`/admin/content/${encodeURIComponent(f.id)}`); }}>View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
