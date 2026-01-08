import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useUser } from '../context/UserContext';
import { apiGetUserPortfolio, type UserPortfolio } from '../services/portfolioApi';
import { apiGetSavedCards, apiListItems, apiUpdateCardSRSState } from '../services/cfApi';
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from '../types/srsStates';
import type { CardDoc, FilmDoc, LevelFrameworkStats } from '../types';
import FilterPanel from '../components/FilterPanel';
import '../styles/pages/portfolio-page.css';
import '../styles/components/search-result-card.css';
import '../styles/level-framework-styles.css';
import '../styles/typography.css';
import heartScoreIcon from '../assets/icons/heart-score.svg';
import streakScoreIcon from '../assets/icons/streak-score.svg';
import diamondScoreIcon from '../assets/icons/diamond-score.svg';
import coinScoreIcon from '../assets/icons/coin-score.svg';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import filterIcon from '../assets/icons/filter.svg';
import buttonPlayIcon from '../assets/icons/button-play.svg';

export default function PortfolioPage() {
  const { user, preferences } = useUser();
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
  const [savedCards, setSavedCards] = useState<Array<CardDoc & { srs_state: string; film_title?: string; episode_number?: number }>>([]);
  const [allItems, setAllItems] = useState<FilmDoc[]>([]);
  const [serverContentCounts, setServerContentCounts] = useState<Record<string, number>>({});
  const [contentFilter, setContentFilter] = useState<string[]>([]);
  const [filmLevelMap, setFilmLevelMap] = useState<Record<string, { framework: string; level: string; language?: string }[]>>({});
  const [srsDropdownOpen, setSrsDropdownOpen] = useState<Record<string, boolean>>({});
  const srsDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<string>('none');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(['Main Subtitle', 'Image', 'Level', 'Media', 'SRS State', 'Due Date', 'XP Count']));
  const [groupByDropdownOpen, setGroupByDropdownOpen] = useState(false);
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSquares, setGridSquares] = useState<number>(150);
  const [gridWidth, setGridWidth] = useState<string>('100%');
  const [squareSize, setSquareSize] = useState<number>(22);
  const [gridCols, setGridCols] = useState<number>(30);
  const [gridRows, setGridRows] = useState<number>(7);

  // Load portfolio data
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await apiGetUserPortfolio(user.uid);
        if (mounted) {
          setPortfolio(data);
        }
      } catch (error) {
        console.error('Failed to load portfolio:', error);
        if (mounted) {
          setPortfolio(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid]);

  // Parse level framework stats helper
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

  // Get dominant level from stats
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

  // Load saved cards (after allItems is loaded)
  useEffect(() => {
    if (!user?.uid || allItems.length === 0) return;

    let mounted = true;
    (async () => {
      try {
        // Load all saved cards (may need pagination in the future)
        const result = await apiGetSavedCards(user.uid, 1, 1000);
        if (!mounted) return;

        // Load film levels for cards from allItems
        const uniqueFilmIds = [...new Set(result.cards.map(c => c.film_id).filter(Boolean))];
        const levelMap: Record<string, { framework: string; level: string; language?: string }[]> = {};
        
        uniqueFilmIds.forEach((filmId) => {
          if (!filmId) return;
          const film = allItems.find(item => item.id === filmId);
          if (!film) return;
          
          if (film.level_framework_stats) {
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
        });

        if (mounted) {
          setFilmLevelMap(prev => ({ ...prev, ...levelMap }));

          // Helper to parse episode number from slug (fallback if API doesn't provide episode_number)
          const parseEpisodeNum = (episodeId: string | undefined): number | null => {
            if (!episodeId) return null;
            // Try pattern like "e1", "e5", etc.
            const eMatch = episodeId.match(/^e(\d+)$/i);
            if (eMatch) return parseInt(eMatch[1], 10);
            // Try pattern like "alice_in_borderland_s3_001" -> extract last number
            // Match the last underscore followed by digits
            const numMatch = episodeId.match(/_(\d+)$/);
            if (numMatch) {
              const num = parseInt(numMatch[1], 10);
              return num > 0 ? num : null;
            }
            // Try to extract any trailing number sequence
            const endNumMatch = episodeId.match(/(\d+)$/);
            if (endNumMatch) {
              const num = parseInt(endNumMatch[1], 10);
              return num > 0 ? num : null;
            }
            return null;
          };

          // Map levels and episode numbers to cards
          const cardsWithLevels = result.cards.map((c: any) => {
            // Normalize srs_state from API response (ensure lowercase and trim)
            const rawSrsState = c.srs_state;
            const normalizedSrsState = rawSrsState 
              ? String(rawSrsState).toLowerCase().trim() 
              : 'none';
            
            const cardData: CardDoc & { srs_state: string; film_title?: string; episode_number?: number } = {
              ...c,
              // Ensure srs_state is normalized and preserved
              srs_state: normalizedSrsState,
            };
            
            // Add levels
            if (c.film_id && levelMap[c.film_id]) {
              cardData.levels = levelMap[c.film_id];
            } else if (c.film_id && filmLevelMap[c.film_id]) {
              cardData.levels = filmLevelMap[c.film_id];
            }
            
            // Use episode_number from API if available, otherwise parse from slug
            if (c.episode_number && typeof c.episode_number === 'number') {
              cardData.episode_number = c.episode_number;
            } else {
              const epNum = parseEpisodeNum(c.episode_id || c.episode_slug);
              if (epNum !== null) {
                cardData.episode_number = epNum;
              }
            }
            
            return cardData;
          });

          setSavedCards(cardsWithLevels);
        }
      } catch (error) {
        console.error('Failed to load saved cards:', error);
        if (mounted) {
          setSavedCards([]);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid, allItems]);

  // Load all content items
  useEffect(() => {
    let cancelled = false;
    apiListItems()
      .then((items) => {
        if (!cancelled) {
          setAllItems(items);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load content items:", error);
          setAllItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch content counts for saved cards
  useEffect(() => {
    if (!isFilterPanelOpen || !user?.uid) {
      return;
    }
    
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      const run = async () => {
        try {
          // Get unique content IDs from saved cards filtered by main language
          const mainLang = preferences?.main_language || null;
          const contentIdsSet = new Set<string>();
          savedCards.forEach(card => {
            if (card.film_id) {
              const item = allItems.find(item => item.id === card.film_id);
              if (!mainLang || item?.main_language === mainLang) {
                contentIdsSet.add(card.film_id);
              }
            }
          });
          
          // Count saved cards per content
          const counts: Record<string, number> = {};
          savedCards.forEach(card => {
            if (card.film_id && contentIdsSet.has(card.film_id)) {
              counts[card.film_id] = (counts[card.film_id] || 0) + 1;
            }
          });
          
          if (!cancelled) {
            setServerContentCounts(counts);
          }
        } catch (error) {
          if (!cancelled) {
            console.error("Failed to calculate content counts:", error);
            setServerContentCounts({});
          }
        }
      };
      run();
    }, 500);
    
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [user?.uid, savedCards, allItems, preferences?.main_language, isFilterPanelOpen]);

  // Close SRS dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      Object.keys(srsDropdownRefs.current).forEach((cardId) => {
        const ref = srsDropdownRefs.current[cardId];
        if (ref && !ref.contains(event.target as Node)) {
          setSrsDropdownOpen(prev => ({ ...prev, [cardId]: false }));
        }
      });
    };
    
    if (Object.values(srsDropdownOpen).some(open => open)) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [srsDropdownOpen]);

  // Handle SRS state change
  const handleSRSStateChange = useCallback(async (card: CardDoc, newState: SRSState) => {
    if (!user?.uid || !card.id) return;
    
    try {
      const filmId = card.film_id || '';
      const episodeId = card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''));
      
      if (!filmId || !episodeId) {
        console.error('Missing film_id or episode_id for SRS update:', { filmId, episodeId, card });
        return;
      }
      
      await apiUpdateCardSRSState(
        user.uid, 
        card.id, 
        newState,
        filmId,
        episodeId
      );
      
      // Update card in savedCards
      setSavedCards(prev => prev.map(c => 
        c.id === card.id ? { ...c, srs_state: newState } as CardDoc & { srs_state: string } : c
      ));
      
      setSrsDropdownOpen(prev => ({ ...prev, [card.id]: false }));
    } catch (error) {
      console.error('Failed to update SRS state:', error);
    }
  }, [user?.uid]);

  useEffect(() => {
    const calculateGridSquares = () => {
      if (!gridRef.current) return;
      
      const container = gridRef.current.parentElement;
      if (!container) return;
      
      const containerWidth = container.clientWidth;
      const containerHeight = 155; // Fixed height
      const padding = 2 * 2; // padding left + right
      const gap = 2;
      const targetCols = 30; // Số cột mong muốn
      const targetRows = 7; // Số hàng mong muốn
      
      // Tính kích thước ô vuông động dựa trên width và height
      const availableWidth = containerWidth - padding;
      const availableHeight = containerHeight - padding;
      
      // Tính kích thước ô dựa trên width
      const squareSizeFromWidth = (availableWidth - (targetCols - 1) * gap) / targetCols;
      // Tính kích thước ô dựa trên height
      const squareSizeFromHeight = (availableHeight - (targetRows - 1) * gap) / targetRows;
      
      // Lấy min để đảm bảo fit cả 2 chiều và giữ hình vuông
      const calculatedSquareSize = Math.min(squareSizeFromWidth, squareSizeFromHeight);
      
      // Tính lại số cột và hàng chính xác với kích thước đã tính
      const cols = Math.floor((availableWidth + gap) / (calculatedSquareSize + gap));
      const rows = Math.floor((availableHeight + gap) / (calculatedSquareSize + gap));
      
      // Tính width và height chính xác để không có khoảng trống
      const exactWidth = cols * (calculatedSquareSize + gap) - gap + padding;
      const exactHeight = rows * (calculatedSquareSize + gap) - gap + padding;
      
      setSquareSize(calculatedSquareSize);
      setGridCols(cols);
      setGridRows(rows);
      setGridWidth(`${exactWidth}px`);
      
      if (gridRef.current) {
        gridRef.current.style.height = `${exactHeight}px`;
      }
      
      const totalSquares = cols * rows;
      setGridSquares(Math.max(0, totalSquares));
    };

    // Delay để đảm bảo DOM đã render
    setTimeout(calculateGridSquares, 0);
    
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(calculateGridSquares, 0);
    });
    
    if (gridRef.current?.parentElement) {
      resizeObserver.observe(gridRef.current.parentElement);
    }

    window.addEventListener('resize', calculateGridSquares);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculateGridSquares);
    };
  }, [portfolio]);

  // Filter saved cards by content filter and main language
  const filteredSavedCards = useMemo(() => {
    let filtered = savedCards;

    // Filter by main language
    if (preferences?.main_language) {
      const mainLang = preferences.main_language;
      filtered = filtered.filter(card => {
        const item = allItems.find(item => item.id === card.film_id);
        return item?.main_language === mainLang;
      });
    }

    // Filter by content filter
    if (contentFilter.length > 0) {
      filtered = filtered.filter(card => contentFilter.includes(card.film_id || ''));
    }

    // Filter by table search query
    if (tableSearchQuery.trim()) {
      const query = tableSearchQuery.toLowerCase();
      filtered = filtered.filter(card => {
        const mainLang = preferences?.main_language || 'en';
        const subtitle = card.subtitle?.[mainLang] || card.sentence || '';
        const film = allItems.find(item => item.id === card.film_id);
        const filmTitle = film?.title || '';
        return subtitle.toLowerCase().includes(query) || filmTitle.toLowerCase().includes(query);
      });
    }

    return filtered;
  }, [savedCards, preferences?.main_language, allItems, contentFilter, tableSearchQuery]);

  // Filter items by mainLanguage and only show items that user has saved cards
  const filteredItems = useMemo(() => {
    const mainLang = preferences?.main_language || "en";
    // Get unique content IDs from saved cards
    const savedContentIds = new Set<string>();
    savedCards.forEach(card => {
      if (card.film_id) {
        savedContentIds.add(card.film_id);
      }
    });
    
    // Filter by main language and only include items with saved cards
    return allItems.filter((item) => {
      return item.main_language === mainLang && savedContentIds.has(item.id);
    });
  }, [allItems, preferences?.main_language, savedCards]);

  // Build maps for FilterPanel from all items (filtered by mainLanguage)
  const filmTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    filteredItems.forEach((item) => {
      if (item.id) {
        map[item.id] = item.title || item.id;
      }
    });
    return map;
  }, [filteredItems]);

  const filmTypeMap = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    filteredItems.forEach((item) => {
      if (item.id) {
        map[item.id] = item.type;
      }
    });
    return map;
  }, [filteredItems]);

  const filmLangMap = useMemo(() => {
    const map: Record<string, string> = {};
    filteredItems.forEach((item) => {
      if (item.id && item.main_language) {
        map[item.id] = item.main_language;
      }
    });
    return map;
  }, [filteredItems]);

  const filmStatsMap = useMemo(() => {
    const map: Record<string, LevelFrameworkStats | null> = {};
    filteredItems.forEach((item) => {
      if (item.id) {
        const raw = item.level_framework_stats;
        if (!raw) {
          map[item.id] = null;
        } else if (Array.isArray(raw)) {
          map[item.id] = raw as unknown as LevelFrameworkStats;
        } else if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            map[item.id] = Array.isArray(parsed) ? (parsed as unknown as LevelFrameworkStats) : null;
          } catch {
            map[item.id] = null;
          }
        } else {
          map[item.id] = null;
        }
      }
    });
    return map;
  }, [filteredItems]);

  const allContentIds = useMemo(() => {
    return filteredItems.map((item) => item.id).filter((id): id is string => !!id);
  }, [filteredItems]);

  // Content counts: merge serverContentCounts with allContentIds
  const contentCounts = useMemo(() => {
    const merged: Record<string, number> = { ...serverContentCounts };
    
    if (allContentIds && allContentIds.length > 0) {
      for (const id of allContentIds) {
        if (!(id in merged)) {
          merged[id] = 0;
        }
      }
    }
    
    return merged;
  }, [serverContentCounts, allContentIds]);

  if (!user) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        Please sign in to view your portfolio
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        Loading...
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        No portfolio data available
      </div>
    );
  }

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Sample data for line graph
  const xpProgressData = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550];

  // Generate date labels (10 dates, Dec 24 is Today, going backwards then forward)
  const today = new Date(2025, 11, 24); // Dec 24, 2025
  const dateLabels = Array.from({ length: 10 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (9 - i)); // Start from Dec 15, end at Dec 24
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    return { label: `${month} ${day}`, isToday: i === 9 };
  });

  return (
    <div className={`portfolio-page-container typography-pressstart-1 ${!isFilterPanelOpen ? 'filter-panel-closed' : ''}`}>
      {/* Overlay for mobile - click outside to close */}
      <div 
        className="filter-panel-overlay"
        onClick={() => setIsFilterPanelOpen(false)}
        aria-hidden="true"
      />

      <FilterPanel
        filmTitleMap={filmTitleMap}
        filmTypeMap={filmTypeMap}
        filmLangMap={filmLangMap}
        filmStatsMap={filmStatsMap}
        allResults={filteredSavedCards}
        contentCounts={contentCounts}
        totalCount={filteredSavedCards.length}
        allContentIds={allContentIds}
        filmFilter={contentFilter}
        onSelectFilm={setContentFilter}
        mainLanguage={preferences?.main_language || "en"}
        isOpen={isFilterPanelOpen}
        onClose={() => setIsFilterPanelOpen(false)}
      />

      {/* Header Stats */}
      <div className="portfolio-header">
        <button
          className="filter-panel-toggle-btn"
          onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
          aria-label={
            isFilterPanelOpen ? "Close filter panel" : "Open filter panel"
          }
        >
          <img
            src={rightAngleIcon}
            alt="Toggle filter"
            className={isFilterPanelOpen ? "rotate-180" : ""}
          />
          <img
            src={filterIcon}
            alt="Filter"
            className="filter-icon"
          />
        </button>
        <div className="portfolio-header-stats">
          <div className="portfolio-stat-group portfolio-stat-group-left">
          <div className="portfolio-stat-item">
              <img src={heartScoreIcon} alt="Saved Cards" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_cards_saved.toLocaleString()} cards</span>
          </div>
          </div>
          <div className="portfolio-stat-group portfolio-stat-group-right">
          <div className="portfolio-stat-item">
              <img src={streakScoreIcon} alt="Streak" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.current_streak} days</span>
          </div>
          <div className="portfolio-stat-item">
              <img src={diamondScoreIcon} alt="XP" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_xp.toLocaleString()}xp</span>
          </div>
          <div className="portfolio-stat-item">
              <img src={coinScoreIcon} alt="Coins" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.coins.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Cards Section */}
      <div className="portfolio-metrics-section">
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">{portfolio.total_cards_reviewed.toLocaleString()}</div>
          <div className="portfolio-metric-label">
            # Due Cards
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">{Math.round(portfolio.total_listening_time / 60).toLocaleString()}</div>
          <div className="portfolio-metric-label">
            Listening Time (min)
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">{Math.round(portfolio.total_reading_time / 60).toLocaleString()}</div>
          <div className="portfolio-metric-label">
            Reading Time (min)
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">{(0).toLocaleString()}</div>
          <div className="portfolio-metric-label">
            # Speaking Words
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">{(0).toLocaleString()}</div>
          <div className="portfolio-metric-label">
            # Writing Words
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="portfolio-graphs-section">
        {/* XP Progress Graph */}
        <div className="portfolio-graph-card">
          <div className="portfolio-graph-header">
            <div className="portfolio-graph-nav">
              <button className="portfolio-graph-nav-btn">
                <img src={buttonPlayIcon} alt="Previous" className="portfolio-graph-nav-icon portfolio-graph-nav-icon-left" />
              </button>
              <button className="portfolio-graph-nav-btn">
                <img src={buttonPlayIcon} alt="Next" className="portfolio-graph-nav-icon" />
              </button>
            </div>
          </div>
          <div className="portfolio-graph-container">
            <div className="portfolio-graph-placeholder">
              <svg width="100%" height="100%" viewBox="0 0 1000 220" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0 }}>
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <line key={y} x1="0" y1={y * 2} x2="1000" y2={y * 2} stroke="var(--neutral)" strokeWidth="0.5" opacity="0.3" />
                ))}
                {/* Area fill */}
                <polygon
                  points={`0,200 ${xpProgressData.map((value, i) => {
                    const x = (i / (xpProgressData.length - 1)) * 1000;
                    const y = 200 - (value / 700) * 200;
                    return `${x},${y}`;
                  }).join(' ')},1000,200`}
                  fill="var(--primary)"
                  opacity="0.2"
                />
                {/* Line graph */}
                <polyline
                  points={xpProgressData.map((value, i) => {
                    const x = (i / (xpProgressData.length - 1)) * 1000;
                    const y = 200 - (value / 700) * 200;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                />
                {/* Data points - squares */}
                {xpProgressData.map((value, i) => {
                  const x = (i / (xpProgressData.length - 1)) * 1000;
                  const y = 200 - (value / 700) * 200;
                  return (
                    <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill="var(--primary)" stroke="var(--background)" strokeWidth="1" />
                  );
                })}
                {/* Date labels */}
                {dateLabels.map((date, i) => {
                  const x = (i / (dateLabels.length - 1)) * 1000;
                  return (
                    <g key={i}>
                      {date.isToday && (
                        <line x1={x} y1="0" x2={x} y2="200" stroke="var(--hover-select)" strokeWidth="1.5" strokeDasharray="4 4" />
                      )}
                      <text 
                        x={x} 
                        y="215" 
                        textAnchor="middle" 
                        className="portfolio-graph-date-label"
                        fill={date.isToday ? "var(--hover-select)" : "var(--text)"}
                      >
                        {date.label}
                      </text>
                      {date.isToday && (
                        <text x={x} y="-5" textAnchor="middle" className="portfolio-graph-today-label">Today</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="portfolio-heatmap-section">
        <div 
          ref={gridRef} 
          className="portfolio-grid-pattern" 
          style={{ 
            width: gridWidth,
            gridTemplateColumns: `repeat(${gridCols}, ${squareSize}px)`,
            gridTemplateRows: `repeat(${gridRows}, ${squareSize}px)`
          }}
        >
          {Array.from({ length: gridSquares }).map((_, i) => {
            const rand = Math.random();
            let colorClass = 'neutral';
            if (rand < 0.33) {
              colorClass = 'neutral';
            } else if (rand < 0.66) {
              colorClass = 'primary';
            } else {
              colorClass = 'hover-select';
            }
            return (
              <div 
                key={i} 
                className={`portfolio-grid-square portfolio-grid-square-${colorClass}`}
              />
            );
          })}
        </div>
      </div>

      {/* Saved Cards Table Section */}
      <div className="portfolio-table-section">
        {/* Table Header Controls */}
        <div className="portfolio-table-header">
          <div className="portfolio-table-header-left">
            <div className="portfolio-table-search-wrapper">
              <input
                type="text"
                value={tableSearchQuery}
                onChange={(e) => setTableSearchQuery(e.target.value)}
                placeholder="Search cards..."
                className="portfolio-table-search-input"
              />
            </div>
            <button className="portfolio-table-filter-btn" aria-label="Filter">
              <img src={filterIcon} alt="Filter" />
            </button>
            <div className="portfolio-table-dropdown-wrapper">
              <button
                className="portfolio-table-dropdown-btn"
                onClick={() => {
                  setGroupByDropdownOpen(!groupByDropdownOpen);
                  setColumnsDropdownOpen(false);
                }}
              >
                <span>Group By</span>
                {groupBy === 'save_date' && (
                  <span className="portfolio-table-dropdown-info">Save Date</span>
                )}
                <img src={buttonPlayIcon} alt="" className={groupByDropdownOpen ? 'rotate-90' : ''} />
              </button>
              {groupByDropdownOpen && (
                <div className="portfolio-table-dropdown-menu">
                  <button
                    className={`portfolio-table-dropdown-item ${groupBy === 'none' ? 'active' : ''}`}
                    onClick={() => {
                      setGroupBy('none');
                      setGroupByDropdownOpen(false);
                    }}
                  >
                    None
                  </button>
                  <button
                    className={`portfolio-table-dropdown-item ${groupBy === 'save_date' ? 'active' : ''}`}
                    onClick={() => {
                      setGroupBy('save_date');
                      setGroupByDropdownOpen(false);
                    }}
                  >
                    Save Date
                  </button>
              </div>
            )}
            </div>
            <div className="portfolio-table-dropdown-wrapper">
              <button
                className="portfolio-table-dropdown-btn"
                onClick={() => {
                  setColumnsDropdownOpen(!columnsDropdownOpen);
                  setGroupByDropdownOpen(false);
                }}
              >
                <span>Columns</span>
                <span className="portfolio-table-dropdown-info">{selectedColumns.size}</span>
                <img src={buttonPlayIcon} alt="" className={columnsDropdownOpen ? 'rotate-90' : ''} />
              </button>
              {columnsDropdownOpen && (
                <div className="portfolio-table-dropdown-menu">
                  {['Main Subtitle', 'Image', 'Level', 'Media', 'SRS State', 'Due Date', 'XP Count'].map((col) => {
                    const isChecked = selectedColumns.has(col);
                    return (
                      <button
                        key={col}
                        type="button"
                        className={`portfolio-table-dropdown-item ${isChecked ? 'selected' : ''}`}
                        onClick={() => {
                          const newSet = new Set(selectedColumns);
                          if (isChecked) {
                            newSet.delete(col);
                          } else {
                            newSet.add(col);
                          }
                          setSelectedColumns(newSet);
                        }}
                      >
                        <span className={`portfolio-table-dropdown-checkbox ${isChecked ? 'checked' : ''}`}>
                          {isChecked && <span className="portfolio-table-dropdown-checkmark">✓</span>}
                        </span>
                        <span>{col}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <button className="portfolio-table-practice-btn typography-pressstart-1">
            Practice
          </button>
        </div>
        <div className="portfolio-table-container">
          <table className="portfolio-saved-cards-table">
            <thead>
              <tr>
                {selectedColumns.has('Main Subtitle') && <th>Main Subtitle</th>}
                {selectedColumns.has('Image') && <th>Image</th>}
                {selectedColumns.has('Level') && <th>Level</th>}
                {selectedColumns.has('Media') && <th>Media</th>}
                {selectedColumns.has('SRS State') && <th>SRS State</th>}
                {selectedColumns.has('Due Date') && <th>Due Date</th>}
                {selectedColumns.has('XP Count') && <th>XP Count</th>}
              </tr>
            </thead>
            <tbody>
              {filteredSavedCards.length === 0 ? (
                <tr>
                  <td colSpan={selectedColumns.size} style={{ textAlign: 'center', padding: '40px', color: 'var(--neutral)' }}>
                    No saved cards found
                  </td>
                </tr>
              ) : (
                filteredSavedCards.map((card, idx) => {
                  const film = allItems.find(item => item.id === card.film_id);
                  const mainLang = preferences?.main_language || 'en';
                  const mainSubtitle = card.subtitle?.[mainLang] || card.sentence || '';
                  // Get srs_state from card (already normalized in cardsWithLevels)
                  const srsState = (card as any).srs_state || 'none';
                  const episodeNum = (card as any).episode_number || null;
                  
                  return (
                    <tr key={card.id || idx}>
                      {selectedColumns.has('Main Subtitle') && (
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input type="checkbox" />
                            <span style={{ 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap',
                              maxWidth: '200px'
                            }}>
                              {mainSubtitle}
                            </span>
                          </div>
                        </td>
                      )}
                      {selectedColumns.has('Image') && (
                        <td style={{ textAlign: 'center' }}>
                          {card.image_url ? (
                            <img 
                              src={card.image_url} 
                              alt="" 
                              style={{ 
                                width: '40px', 
                                height: '40px', 
                                objectFit: 'cover', 
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'block',
                                margin: '0 auto'
                              }}
                              onClick={() => {
                                // Open image in new window
                                const w = window.open('', '_blank');
                                if (w && card.image_url) {
                                  w.document.write(`
                                    <!DOCTYPE html>
                                    <html>
                                      <head>
                                        <title>Image Preview</title>
                                        <style>
                                          * { margin: 0; padding: 0; box-sizing: border-box; }
                                          body {
                                            display: flex;
                                            justify-content: center;
                                            align-items: center;
                                            min-height: 100vh;
                                            background: #000;
                                          }
                                          img {
                                            max-width: 90vw;
                                            max-height: 90vh;
                                            object-fit: contain;
                                          }
                                        </style>
                                      </head>
                                      <body>
                                        <img src="${card.image_url}" alt="Card Image" />
                                      </body>
                                    </html>
                                  `);
                                  w.document.close();
                                }
                              }}
                            />
                          ) : (
                            <div style={{ width: '40px', height: '40px', background: 'var(--hover-bg)', borderRadius: '4px', margin: '0 auto' }} />
                          )}
                        </td>
                      )}
                      {selectedColumns.has('Level') && (
                        <td>
                          {card.levels && card.levels.length > 0 ? (
                            card.levels.map((lvl: { framework: string; level: string; language?: string }, lvlIdx: number) => (
                              <span key={lvlIdx} className={`level-badge level-${(lvl.level || '').toLowerCase()}`}>
                                {lvl.level}
                              </span>
                            ))
                          ) : (
                            <span className="level-badge level-unknown">?</span>
                          )}
                        </td>
                      )}
                      {selectedColumns.has('Media') && (
                        <td>
                          {film?.title && (
                            <span className="portfolio-media-content-badge">
                              {film.title.length > 20 ? film.title.substring(0, 20) + '...' : film.title}
                              {episodeNum && (
                                <span className="portfolio-media-episode-badge">
                                  Ep {episodeNum}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      )}
                      {selectedColumns.has('SRS State') && (
                        <td>
                          {(() => {
                            // srsState is already normalized in cardsWithLevels
                            // Show SRS dropdown if state exists and is not 'none'
                            if (srsState && srsState !== 'none' && srsState !== '') {
                              // Check if it's a valid SRS state, if not, still show it but use 'new' as fallback class
                              const isValidSRSState = SELECTABLE_SRS_STATES.includes(srsState as SRSState);
                              const displayState = isValidSRSState ? srsState : 'new';
                              const displayLabel = isValidSRSState 
                                ? SRS_STATE_LABELS[srsState as SRSState] 
                                : srsState.toUpperCase();
                              
                              return (
                                <div className="card-srs-dropdown-container" ref={(el) => { 
                                  if (el && card.id) {
                                    srsDropdownRefs.current[card.id] = el;
                                  }
                                }}>
                                  <button
                                    type="button"
                                    className={`card-srs-dropdown-btn srs-${displayState}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      if (card.id) {
                                        setSrsDropdownOpen(prev => {
                                          const newState = { ...prev };
                                          // Close all other dropdowns
                                          Object.keys(newState).forEach(key => {
                                            if (key !== card.id) newState[key] = false;
                                          });
                                          newState[card.id] = !prev[card.id];
                                          return newState;
                                        });
                                      }
                                    }}
                                  >
                                    <span className="card-srs-dropdown-text">{displayLabel}</span>
                                    <img src={buttonPlayIcon} alt="Dropdown" className="card-srs-dropdown-icon" />
                                  </button>
                                  
                                  {card.id && srsDropdownOpen[card.id] && (
                                    <div className="card-srs-dropdown-menu">
                                      {SELECTABLE_SRS_STATES.map((state) => (
                                        <button
                                          key={state}
                                          type="button"
                                          className={`card-srs-dropdown-item srs-${state} ${srsState === state ? 'active' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            handleSRSStateChange(card, state);
                                          }}
                                        >
                                          {SRS_STATE_LABELS[state]}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return <span style={{ color: 'var(--neutral)' }}>-</span>;
                          })()}
                        </td>
                      )}
                      {selectedColumns.has('Due Date') && (
                        <td>
                          {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                      )}
                      {selectedColumns.has('XP Count') && (
                        <td>22 XP</td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats Grid (moved to bottom) */}
      <div className="portfolio-stats-section">
        <h2 className="portfolio-stats-title typography-inter-1">Statistics</h2>
        <div className="portfolio-stats-grid">
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Total XP</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_xp.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Level</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.level}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Coins</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.coins.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Current Streak</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.current_streak} days</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Longest Streak</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.longest_streak} days</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Cards Saved</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_cards_saved.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Cards Reviewed</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_cards_reviewed.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Listening Time</div>
            <div className="portfolio-stat-value typography-inter-1">{formatTime(portfolio.total_listening_time)}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Reading Time</div>
            <div className="portfolio-stat-value typography-inter-1">{formatTime(portfolio.total_reading_time)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
