import { useEffect, useState } from 'react';
import { apiFetchAllCards } from '../../services/cfApi';
import type { CardDoc } from '../../types';

export default function AdminCardsPage() {
  const [rows, setRows] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // removed Add cards button; navigation not needed here

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const cards = await apiFetchAllCards(500);
        if (!mounted) return;
        setRows(cards);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Cards</h2>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Card ID</th>
              <th>Film</th>
              <th>Episode</th>
              <th>Start</th>
              <th>End</th>
              <th>Sentence</th>
              <th>CEFR</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id+':'+r.episode}>
                <td>{r.id}</td>
                <td>{r.film_id}</td>
                <td>{r.episode}</td>
                <td>{r.start}</td>
                <td>{r.end}</td>
                <td className="admin-cell-ellipsis" title={r.sentence || ''}>{r.sentence || ''}</td>
                <td>{r.CEFR_Level || ''}</td>
                <td>{(r as unknown as { type?: string }).type || ''}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={8} className="admin-empty">No cards found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
