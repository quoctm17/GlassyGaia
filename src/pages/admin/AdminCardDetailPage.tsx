import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetCardByPath } from '../../services/cfApi';
import type { CardDoc } from '../../types';

export default function AdminCardDetailPage() {
  const { filmSlug, episodeId, cardId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filmSlug || !episodeId || !cardId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const c = await apiGetCardByPath(filmSlug, episodeId, cardId);
        if (!mounted) return;
        setCard(c);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [filmSlug, episodeId, cardId]);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Card {cardId}</h2>
        <button className="admin-btn secondary" onClick={() => navigate(`/admin/films/${encodeURIComponent(filmSlug!)}`)}>← Back to film</button>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      {card && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-2">
            <div><span className="font-semibold">Episode:</span> {episodeId}</div>
            <div><span className="font-semibold">Start:</span> {card.start}s</div>
            <div><span className="font-semibold">End:</span> {card.end}s</div>
            <div><span className="font-semibold">Sentence:</span> {card.sentence || '-'}</div>
            <div><span className="font-semibold">CEFR:</span> {card.CEFR_Level || '-'}</div>
            <div>
              <span className="font-semibold">Subtitles:</span>
              <div className="mt-2 text-xs space-y-1">
                {Object.entries(card.subtitle || {}).map(([lang, text]) => (
                  <div key={lang}><span className="opacity-70">[{lang}]</span> {text}</div>
                ))}
                {Object.keys(card.subtitle || {}).length === 0 && <div className="opacity-70">(none)</div>}
              </div>
            </div>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-3">
            <div className="text-sm font-semibold mb-2">Media</div>
            <div className="space-y-2">
              <div>
                <div className="text-xs opacity-80">Image</div>
                {card.image_url ? <img src={card.image_url} alt="card" className="max-w-full rounded border border-gray-700" /> : <div className="text-xs opacity-70">(no image)</div>}
              </div>
              <div>
                <div className="text-xs opacity-80">Audio</div>
                {card.audio_url ? <audio controls src={card.audio_url} className="w-full" /> : <div className="text-xs opacity-70">(no audio)</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
