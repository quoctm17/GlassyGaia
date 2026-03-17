import { useEffect, useState } from 'react';
import { apiFetchUnavailableCards, apiUpdateCardAvailability } from '../../services/cfApi';
import type { CardDoc } from '../../types';
import { Check, RefreshCw, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import '../../styles/components/admin/admin-forms.css';

interface UnavailableCard extends CardDoc {
  filmSlug?: string;
  episodeSlug?: string;
}

export default function AdminUnavailableCardsPage() {
  const [cards, setCards] = useState<UnavailableCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    try {
      setLoading(true);
      const data = await apiFetchUnavailableCards();
      // Add film/episode slug info for the update API
      const cardsWithSlug = data.map(card => ({
        ...card,
        filmSlug: card.film_id,
        episodeSlug: (card as unknown as { episode_slug?: string }).episode_slug || String(card.episode_number || '').padStart(3, '0'),
      }));
      setCards(cardsWithSlug);
    } catch (e) {
      toast.error(`Failed to load cards: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAvailable = async (card: UnavailableCard) => {
    try {
      setUpdatingId(card.id);
      const filmId = card.filmSlug || card.film_id || '';
      const episodeNum = card.episodeSlug || String(card.episode_number || '').padStart(3, '0');
      await apiUpdateCardAvailability(
        filmId,
        episodeNum,
        String(card.card_number).padStart(4, '0'),
        true
      );
      toast.success('Card marked as available');
      // Remove from list
      setCards(prev => prev.filter(c => c.id !== card.id));
    } catch (e) {
      toast.error(`Failed to update: ${(e as Error).message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const getUnavailableReason = (card: UnavailableCard): string => {
    const reasons: string[] = [];
    if (card.is_available === false) reasons.push('Unavailable flag');
    if (!card.length || card.length === 0) reasons.push('Zero length');
    if (card.sentence) {
      if (/^\[\]+$/.test(card.sentence)) reasons.push('Only brackets');
      if (/NETFLIX/i.test(card.sentence)) reasons.push('Contains NETFLIX');
    }
    return reasons.join(', ') || 'Unknown';
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Unavailable Cards</h1>
        <p className="admin-page-subtitle">
          Cards marked as unavailable, zero length, or containing invalid data
        </p>
      </div>

      <div className="admin-toolbar">
        <button className="admin-btn" onClick={loadCards} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <span className="admin-toolbar-info">
          {cards.length} card{cards.length !== 1 ? 's' : ''} found
        </span>
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : cards.length === 0 ? (
        <div className="admin-empty">
          <AlertCircle className="w-8 h-8 mb-2" />
          <p>No unavailable cards found</p>
        </div>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Card #</th>
                <th>Episode</th>
                <th>Film ID</th>
                <th>Sentence</th>
                <th>Length</th>
                <th>Available</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map(card => (
                <tr key={card.id}>
                  <td>{String(card.card_number).padStart(4, '0')}</td>
                  <td>Ep {(card as unknown as { episode_number?: number }).episode_number || card.episode_number || '?'}</td>
                  <td>{card.film_id}</td>
                  <td className="admin-table-text-cell" title={card.sentence || ''}>
                    {card.sentence?.substring(0, 50)}{card.sentence && card.sentence.length > 50 ? '...' : ''}
                  </td>
                  <td>{card.length || 0}</td>
                  <td>{card.is_available === true ? 'Yes' : 'No'}</td>
                  <td>{getUnavailableReason(card)}</td>
                  <td>
                    <button
                      className="admin-btn primary"
                      onClick={() => handleMarkAvailable(card)}
                      disabled={updatingId === card.id}
                    >
                      {updatingId === card.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 mr-1" />
                      )}
                      Mark Available
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
