import { useEffect, useState, useMemo, useCallback } from 'react';
import { useUser } from '../context/UserContext';
import { apiGetSavedCards, apiGetFilm, apiToggleSaveCard } from '../services/cfApi';
import type { CardDoc, LevelFrameworkStats } from '../types';
import SearchResultCard from '../components/SearchResultCard';
import '../styles/pages/search-page.css';

export default function SavedCardsPage() {
  const { user, preferences } = useUser();
  const [cards, setCards] = useState<Array<CardDoc & { srs_state: string; film_title?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});
  const [filmLevelMap, setFilmLevelMap] = useState<Record<string, { framework: string; level: string; language?: string }[]>>({});
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [unsaving, setUnsaving] = useState(false);

  // Helpers to parse level framework stats and get dominant level
  const parseLevelStats = (raw: unknown): LevelFrameworkStats | null => {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw as LevelFrameworkStats;
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? (arr as LevelFrameworkStats) : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const getDominantLevel = (stats: LevelFrameworkStats | null): string | null => {
    if (!stats || !Array.isArray(stats) || stats.length === 0) return null;
    let maxLevel: string | null = null;
    let maxPercent = 0;
    for (const entry of stats as any[]) {
      if (!entry || !entry.levels || typeof entry.levels !== 'object') continue;
      for (const [level, percent] of Object.entries(entry.levels as Record<string, number>)) {
        if (typeof percent === 'number' && percent > maxPercent) {
          maxPercent = percent;
          maxLevel = level.toUpperCase();
        }
      }
    }
    return maxLevel;
  };

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        
        // Load all saved cards by paginating through all pages
        let allCards: Array<CardDoc & { srs_state: string; film_title?: string }> = [];
        let currentPage = 1;
        let hasMore = true;
        let totalCount = 0;
        
        while (hasMore && mounted) {
          const result = await apiGetSavedCards(user.uid, currentPage, 100); // Use larger limit
          if (!mounted) return;
          
          allCards = [...allCards, ...result.cards];
          totalCount = result.total;
          hasMore = result.has_more;
          currentPage++;
          
          // Safety limit to prevent infinite loop
          if (currentPage > 1000) break;
        }
        
        if (!mounted) return;
        
        // Load film languages for primaryLang and level badges
        const uniqueFilmIds = [...new Set(allCards.map(c => c.film_id).filter(Boolean))];
        const langMap: Record<string, string> = {};
        const levelMap: Record<string, { framework: string; level: string; language?: string }[]> = {};
        await Promise.all(uniqueFilmIds.map(async (filmId) => {
          if (!filmId) return;
          try {
            const film = await apiGetFilm(filmId);
            if (film?.main_language) {
              langMap[filmId] = film.main_language;
            }
            if (film?.level_framework_stats) {
              const stats = parseLevelStats(film.level_framework_stats);
              const dominant = getDominantLevel(stats);
              if (dominant) {
                // Use first framework entry if available, otherwise generic
                let framework = 'level';
                if (stats && stats.length > 0 && (stats as any)[0]?.framework) {
                  framework = (stats as any)[0].framework;
                }
                levelMap[filmId] = [{ framework, level: dominant }];
              }
            }
          } catch (error) {
            console.error(`Failed to load film ${filmId}:`, error);
          }
        }));
        
        if (mounted) {
          setFilmLangMap(prev => ({ ...prev, ...langMap }));
          setFilmLevelMap(prev => ({ ...prev, ...levelMap }));

          const cardsWithLevels = allCards.map((c) => {
            if (c.film_id && levelMap[c.film_id]) {
              return {
                ...c,
                levels: levelMap[c.film_id],
              } as CardDoc & { srs_state: string; film_title?: string };
            }
            // If we already have levels cached from previous pages, use them
            if (c.film_id && filmLevelMap[c.film_id]) {
              return {
                ...c,
                levels: filmLevelMap[c.film_id],
              } as CardDoc & { srs_state: string; film_title?: string };
            }
            return c;
          });

          setCards(cardsWithLevels);
          setTotal(totalCount);
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
  }, [user?.uid]);

  // Toggle card selection
  const toggleCardSelection = useCallback((cardId: string) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  // Check if all cards are selected
  const allCardsSelected = useMemo(() => {
    return cards.length > 0 && selectedCardIds.size === cards.length;
  }, [cards.length, selectedCardIds.size]);

  // Toggle select all
  const toggleSelectAll = useCallback(() => {
    if (allCardsSelected) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(cards.map(c => c.id)));
    }
  }, [allCardsSelected, cards]);

  // Unsave selected cards
  const handleUnsaveSelected = useCallback(async () => {
    if (!user?.uid || selectedCardIds.size === 0) return;

    setUnsaving(true);
    try {
      const unsavePromises = Array.from(selectedCardIds).map(async (cardId) => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return;

        try {
          await apiToggleSaveCard(
            user.uid,
            cardId,
            card.film_id,
            card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
          );
        } catch (error) {
          console.error(`Failed to unsave card ${cardId}:`, error);
        }
      });

      await Promise.all(unsavePromises);
      
      // Remove unsaved cards from the list
      setCards(prev => prev.filter(c => !selectedCardIds.has(c.id)));
      setSelectedCardIds(new Set());
      setTotal(prev => Math.max(0, prev - selectedCardIds.size));
    } catch (error) {
      console.error('Failed to unsave cards:', error);
    } finally {
      setUnsaving(false);
    }
  }, [user?.uid, selectedCardIds, cards]);

  // Handle individual card unsave (from SearchResultCard)
  const handleCardUnsave = useCallback((cardId: string) => {
    // Remove the card from the list
    setCards(prev => prev.filter(c => c.id !== cardId));
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    setTotal(prev => Math.max(0, prev - 1));
  }, []);

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
            {!loading && cards.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allCardsSelected}
                    onChange={toggleSelectAll}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: 'Noto Sans, sans-serif', fontSize: '14px', color: 'var(--text)' }}>
                    Select All
                  </span>
                </label>
                {selectedCardIds.size > 0 && (
                  <button
                    onClick={handleUnsaveSelected}
                    disabled={unsaving}
                    style={{
                      padding: '8px 16px',
                      background: unsaving ? 'var(--hover-bg)' : '#ef4444',
                      border: '2px solid #ef4444',
                      color: '#ffffff',
                      fontFamily: "'Press Start 2P', monospace",
                      fontSize: '10px',
                      cursor: unsaving ? 'not-allowed' : 'pointer',
                      opacity: unsaving ? 0.6 : 1,
                    }}
                  >
                    {unsaving ? 'UNSAVING...' : `UNSAVE (${selectedCardIds.size})`}
                  </button>
                )}
              </div>
            )}
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
                  const isSelected = selectedCardIds.has(card.id);
                  return (
                    <div key={stableKey} style={{ position: 'relative' }}>
                      <label
                        style={{
                          position: 'absolute',
                          top: '8px',
                          left: '8px',
                          zIndex: 10,
                          cursor: 'pointer',
                          background: 'rgba(0, 0, 0, 0.7)',
                          borderRadius: '4px',
                          padding: '4px',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCardSelection(card.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                      </label>
                      <SearchResultCard
                        card={card}
                        primaryLang={card.film_id ? filmLangMap[card.film_id] || preferences?.main_language : preferences?.main_language}
                        highlightQuery=""
                        onUnsave={handleCardUnsave}
                      />
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

