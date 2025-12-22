import { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiGetSavedCards, apiGetFilm } from '../services/cfApi';
import type { CardDoc } from '../types';
import SearchResultCard from '../components/SearchResultCard';
import '../styles/pages/search-page.css';

export default function SavedCardsPage() {
  const { user, preferences } = useUser();
  const [cards, setCards] = useState<Array<CardDoc & { srs_state: string; film_title?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const result = await apiGetSavedCards(user.uid, page, 50);
        if (!mounted) return;
        
        // Load film languages for primaryLang
        const uniqueFilmIds = [...new Set(result.cards.map(c => c.film_id).filter(Boolean))];
        const langMap: Record<string, string> = {};
        await Promise.all(uniqueFilmIds.map(async (filmId) => {
          if (!filmId) return;
          try {
            const film = await apiGetFilm(filmId);
            if (film?.main_language) {
              langMap[filmId] = film.main_language;
            }
          } catch (error) {
            console.error(`Failed to load film ${filmId}:`, error);
          }
        }));
        
        if (mounted) {
          setFilmLangMap(prev => ({ ...prev, ...langMap }));
          
          if (page === 1) {
            setCards(result.cards);
          } else {
            setCards(prev => [...prev, ...result.cards]);
          }
          setTotal(result.total);
          setHasMore(result.has_more);
        }
      } catch (error) {
        console.error('Failed to load saved cards:', error);
        if (mounted) {
          setCards([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid, page]);

  if (!user) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        Please sign in to view your saved cards
      </div>
    );
  }

  return (
    <div className="search-page-container">
      <div className="search-layout-wrapper">
        <main className="search-main">
          <div className="search-controls">
            <div className="search-stats typography-inter-4">
              {loading ? "Loading..." : `${total} Saved Cards`}
            </div>
          </div>

          <div className="search-results layout-default">
            {loading && cards.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="search-card-skeleton"
                  style={{
                    height: "300px",
                    background:
                      `linear-gradient(90deg, var(--hover-bg) 25%, var(--hover-bg-subtle) 50%, var(--hover-bg) 75%)`,
                    backgroundSize: "200% 100%",
                    animation: "skeleton-loading 1.5s ease-in-out infinite",
                    borderRadius: "8px",
                    marginBottom: "1rem",
                  }}
                />
              ))
            ) : cards.length === 0 ? (
              <div style={{ 
                padding: '40px', 
                textAlign: 'center', 
                color: 'var(--neutral)',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '14px'
              }}>
                No saved cards yet
              </div>
            ) : (
              <>
                {cards.map((card) => {
                  const stableKey = `${card.film_id || "item"}-${
                    card.episode_id || card.episode || "e"
                  }-${card.id}`;
                  return (
                    <SearchResultCard
                      key={stableKey}
                      card={card}
                      primaryLang={card.film_id ? filmLangMap[card.film_id] || preferences?.main_language : preferences?.main_language}
                    />
                  );
                })}
                {hasMore && (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    <button
                      onClick={() => setPage(prev => prev + 1)}
                      style={{
                        padding: '10px 20px',
                        background: 'var(--hover-bg)',
                        border: '2px solid var(--primary)',
                        color: 'var(--text)',
                        fontFamily: "'Press Start 2P', monospace",
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Load More
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

