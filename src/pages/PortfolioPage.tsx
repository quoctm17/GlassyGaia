import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { apiGetUserPortfolio, apiGetStreakHistory, apiGetMonthlyXP, apiGetUserMetrics, type UserPortfolio, type StreakHistoryItem, type MonthlyXPData, type UserMetrics } from '../services/portfolioApi';
import { apiGetSavedCards, apiListItems, apiUpdateCardSRSState } from '../services/cfApi';
import { apiTrackTime } from '../services/userTracking';
import { apiIncrementListeningSession } from '../services/userTracking';
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from '../types/srsStates';
import type { CardDoc, FilmDoc, LevelFrameworkStats } from '../types';
import FilterPanel from '../components/FilterPanel';
import { langLabel } from '../utils/lang';
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
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
  const [savedCards, setSavedCards] = useState<Array<CardDoc & { srs_state: string; film_title?: string; episode_number?: number; created_at?: number | null; state_updated_at?: number | null; next_review_at?: number | null; xp_total?: number; xp_reading?: number; xp_listening?: number; xp_speaking?: number; xp_writing?: number }>>([]);
  const [allItems, setAllItems] = useState<FilmDoc[]>([]);
  const [contentFilter, setContentFilter] = useState<string[]>([]);
  const [filmLevelMap, setFilmLevelMap] = useState<Record<string, { framework: string; level: string; language?: string }[]>>({});
  const [savedCardsLoading, setSavedCardsLoading] = useState(false);
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0); // Total cards from API (all languages) - kept for reference, not used in display (filteredCount is used instead)
  const [hasMoreCards, setHasMoreCards] = useState(false); // Whether there are more cards from API - kept for reference, not used in pagination (filteredCount is used instead)
  const CARDS_PER_PAGE = 50; // Reduced from 100 for better performance
  
  // Suppress unused variable warnings - these are kept for potential future use
  void totalCards;
  void hasMoreCards;
  // All unique content IDs that user has saved cards for (for FilterPanel)
  const [allSavedContentIds, setAllSavedContentIds] = useState<string[]>([]);
  const [srsDropdownOpen, setSrsDropdownOpen] = useState<Record<string, boolean>>({});
  const srsDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<string>('save_date');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(['Main Subtitle', 'Image', 'Level', 'Media', 'SRS State', 'Due Date', 'XP Count']));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupByDropdownOpen, setGroupByDropdownOpen] = useState(false);
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const groupByDropdownRef = useRef<HTMLDivElement>(null);
  const columnsDropdownRef = useRef<HTMLDivElement>(null);
  const [groupByDropdownPosition, setGroupByDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [columnsDropdownPosition, setColumnsDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [practiceModalOpen, setPracticeModalOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<'reading' | 'listening' | 'speaking' | 'writing'>('reading');
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  
  // Toggle card selection
  // card.id is now the unique card ID from database (not card_number)
  const toggleCardSelection = useCallback((card: CardDoc) => {
    setSelectedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(card.id)) {
        newSet.delete(card.id);
      } else {
        newSet.add(card.id);
      }
      return newSet;
    });
  }, []);
  
  // Handle Practice button click
  const handlePracticeClick = useCallback(() => {
    if (selectedCards.size === 0) {
      // If no cards selected, show modal to select skill
      setPracticeModalOpen(true);
    } else {
      // If cards selected, show modal with selected cards
      setPracticeModalOpen(true);
    }
  }, [selectedCards.size]);
  
  // Handle Practice Go button - navigate to practice page
  const handlePracticeGo = useCallback(() => {
    const selectedCardIds = Array.from(selectedCards);
    // If no cards selected, use all visible cards
    const cardsToPractice = selectedCardIds.length > 0 
      ? savedCards.filter(c => selectedCardIds.includes(c.id))
      : savedCards;
    
    // Navigate to practice page with skill and card IDs
    const cardIdsParam = cardsToPractice.map(c => c.id).join(',');
    navigate(`/practice?skill=${selectedSkill}&cards=${cardIdsParam}`);
    setPracticeModalOpen(false);
  }, [selectedCards, selectedSkill, savedCards, navigate]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSquares, setGridSquares] = useState<number>(150);
  const [gridWidth, setGridWidth] = useState<string>('100%');
  const [squareSize, setSquareSize] = useState<number>(22);
  const [gridCols, setGridCols] = useState<number>(30);
  const [gridRows, setGridRows] = useState<number>(7);
  const [streakHistory, setStreakHistory] = useState<StreakHistoryItem[]>([]);
  const [monthlyXPData, setMonthlyXPData] = useState<MonthlyXPData[]>([]);
  const [currentMonth, setCurrentMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  // Selected metrics for each card (index-based)
  const [selectedMetricTypes] = useState<Array<'srs' | 'listening' | 'reading'>>(['srs', 'listening', 'reading']);
  const [selectedMetrics, setSelectedMetrics] = useState<Array<string>>(['due_cards', 'time_minutes', 'time_minutes']);
  
  // Audio and tracking state for table cards
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const readingTimeAccumulatorRef = useRef<number>(0);
  const readingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningTimeAccumulatorRef = useRef<number>(0);
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingStartTimeRef = useRef<Record<string, number>>({});
  const listeningStartTimeRef = useRef<Record<string, number>>({});
  const readingIntervalRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const listeningIntervalRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const hasIncrementedListeningSessionRef = useRef<Record<string, boolean>>({});
  const refreshSavedCardsInProgressRef = useRef<boolean>(false);
  const refreshSavedCardsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshSavedCardsRef = useRef<boolean>(false);

  // Internal function to actually perform the refresh (without debouncing)
  // Only loads one page at a time for better performance
  const performRefreshSavedCards = useCallback(async (page: number = currentPage) => {
    if (!user?.uid || allItems.length === 0) return;
    
    // If already in progress, mark that we need another refresh after this one completes
    if (refreshSavedCardsInProgressRef.current) {
      pendingRefreshSavedCardsRef.current = true;
      return;
    }
    
    refreshSavedCardsInProgressRef.current = true;
    const wasPending = pendingRefreshSavedCardsRef.current;
    pendingRefreshSavedCardsRef.current = false;
    
    try {
      setSavedCardsLoading(true);
      
      // Load only one page at a time
      const result = await apiGetSavedCards(user.uid, page, CARDS_PER_PAGE);
      
      // Update pagination state (keep for internal use, but display will use filteredCount)
      setTotalCards(result.total || 0);
      setHasMoreCards(result.has_more || false);
      
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
            let framework = 'level';
            if (stats && stats.length > 0 && (stats as any)[0]?.framework) {
              framework = (stats as any)[0].framework;
            }
            levelMap[filmId] = [{ framework, level: dominant }];
          }
        }
      });

      // Update filmLevelMap with new level data
      setFilmLevelMap(prev => ({ ...prev, ...levelMap }));

      const parseEpisodeNum = (episodeId: string | undefined): number | null => {
        if (!episodeId) return null;
        const eMatch = episodeId.match(/^e(\d+)$/i);
        if (eMatch) return parseInt(eMatch[1], 10);
        const numMatch = episodeId.match(/_(\d+)$/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          return num > 0 ? num : null;
        }
        const endNumMatch = episodeId.match(/(\d+)$/);
        if (endNumMatch) {
          const num = parseInt(endNumMatch[1], 10);
          return num > 0 ? num : null;
        }
        return null;
      };

      const cardsWithLevels = result.cards.map((c: any) => {
        const rawSrsState = c.srs_state;
        const normalizedSrsState = rawSrsState 
          ? String(rawSrsState).toLowerCase().trim() 
          : 'none';
        
        const cardData: CardDoc & { srs_state: string; film_title?: string; episode_number?: number; created_at?: number | null; state_updated_at?: number | null; next_review_at?: number | null; xp_total?: number; xp_reading?: number; xp_listening?: number; xp_speaking?: number; xp_writing?: number } = {
          ...c,
          srs_state: normalizedSrsState,
          created_at: c.created_at || null,
          state_updated_at: (c as any).state_updated_at || null,
          next_review_at: c.next_review_at || null,
          xp_total: c.xp_total || 0,
          xp_reading: c.xp_reading || 0,
          xp_listening: c.xp_listening || 0,
          xp_speaking: c.xp_speaking || 0,
          xp_writing: c.xp_writing || 0,
        };
        
        if (c.film_id && levelMap[c.film_id]) {
          cardData.levels = levelMap[c.film_id];
        } else if (c.film_id && filmLevelMap[c.film_id]) {
          cardData.levels = filmLevelMap[c.film_id];
        }
        
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
    } catch (error) {
      console.error('Failed to refresh saved cards:', error);
      // On error, set empty array to avoid showing stale data
      setSavedCards([]);
    } finally {
      setSavedCardsLoading(false);
      refreshSavedCardsInProgressRef.current = false;
      
      // If there was a pending refresh or a new one was requested, trigger it
      if (pendingRefreshSavedCardsRef.current || wasPending) {
        pendingRefreshSavedCardsRef.current = false;
        // Use a small delay to avoid immediate re-trigger
        setTimeout(() => {
          performRefreshSavedCards(currentPage);
        }, 200);
      }
    }
  }, [user?.uid, allItems, filmLevelMap, currentPage]);

  // Public debounced refresh function
  const refreshSavedCards = useCallback(() => {
    if (!user?.uid || allItems.length === 0) return;
    
    // Clear any pending debounce timeout
    if (refreshSavedCardsTimeoutRef.current) {
      clearTimeout(refreshSavedCardsTimeoutRef.current);
      refreshSavedCardsTimeoutRef.current = null;
    }
    
    // Debounce: wait 1000ms before actually making the request
    refreshSavedCardsTimeoutRef.current = setTimeout(() => {
      performRefreshSavedCards();
    }, 1000);
  }, [user?.uid, allItems.length, performRefreshSavedCards]);

  // Refresh portfolio stats (for real-time updates)
  const refreshPortfolio = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      const data = await apiGetUserPortfolio(user.uid);
      setPortfolio(data);
    } catch (error) {
      console.error('Failed to refresh portfolio:', error);
    }
  }, [user?.uid]);

  // Track reading time (debounced to avoid too many API calls)
  const handleTrackReading = useCallback(async (seconds: number) => {
    if (!user?.uid || seconds <= 0) return;
    
    readingTimeAccumulatorRef.current += seconds;
    
    // Debounce: accumulate and send every 8 seconds
    if (readingTimeoutRef.current) {
      clearTimeout(readingTimeoutRef.current);
    }
    
    readingTimeoutRef.current = setTimeout(async () => {
      const totalSeconds = readingTimeAccumulatorRef.current;
      if (totalSeconds > 0 && user?.uid) {
        readingTimeAccumulatorRef.current = 0;
        try {
          await apiTrackTime(user.uid, totalSeconds, 'reading');
          // Only refresh portfolio after tracking time (saved cards don't need immediate refresh)
          await refreshPortfolio();
        } catch (error) {
          console.error('Failed to track reading time:', error);
        }
      }
    }, 8000);
  }, [user?.uid, refreshSavedCards, refreshPortfolio]);

  // Track listening time (debounced to avoid too many API calls)
  const handleTrackListening = useCallback(async (seconds: number) => {
    if (!user?.uid || seconds <= 0) return;
    
    listeningTimeAccumulatorRef.current += seconds;
    
    // Debounce: accumulate and send every 5 seconds
    if (listeningTimeoutRef.current) {
      clearTimeout(listeningTimeoutRef.current);
    }
    
    listeningTimeoutRef.current = setTimeout(async () => {
      const totalSeconds = listeningTimeAccumulatorRef.current;
      if (totalSeconds > 0 && user?.uid) {
        listeningTimeAccumulatorRef.current = 0;
        try {
          await apiTrackTime(user.uid, totalSeconds, 'listening');
          // Only refresh portfolio after tracking time (saved cards don't need immediate refresh)
          await refreshPortfolio();
        } catch (error) {
          console.error('Failed to track listening time:', error);
        }
      }
    }, 5000);
  }, [user?.uid, refreshSavedCards, refreshPortfolio]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (readingTimeoutRef.current) {
        clearTimeout(readingTimeoutRef.current);
      }
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current);
      }
      // Send any remaining accumulated time
      if (readingTimeAccumulatorRef.current > 0 && user?.uid) {
        apiTrackTime(user.uid, readingTimeAccumulatorRef.current, 'reading').catch(() => {});
      }
      if (listeningTimeAccumulatorRef.current > 0 && user?.uid) {
        apiTrackTime(user.uid, listeningTimeAccumulatorRef.current, 'listening').catch(() => {});
      }
      // Cleanup all audio refs
      Object.values(audioRefs.current).forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      // Cleanup all intervals
      Object.values(readingIntervalRef.current).forEach(interval => clearInterval(interval));
      Object.values(listeningIntervalRef.current).forEach(interval => clearInterval(interval));
      // Cleanup refresh timeout
      if (refreshSavedCardsTimeoutRef.current) {
        clearTimeout(refreshSavedCardsTimeoutRef.current);
        refreshSavedCardsTimeoutRef.current = null;
      }
    };
  }, [user?.uid]);

  // Handle audio play for table cards
  const handleTableCardAudioPlay = useCallback((card: CardDoc) => {
    if (!card.audio_url || !card.id) return;
    
    const cardId = card.id;
    const isCurrentlyPlaying = playingAudioId === cardId;
    
    // Pause all other audio
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (id !== cardId) {
        audio.pause();
        // Stop tracking listening time for paused audio
        if (listeningStartTimeRef.current[id]) {
          const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current[id]) / 1000);
          if (elapsed > 0) {
            handleTrackListening(elapsed);
          }
          listeningStartTimeRef.current[id] = 0;
        }
        if (listeningIntervalRef.current[id]) {
          clearInterval(listeningIntervalRef.current[id]);
          delete listeningIntervalRef.current[id];
        }
      }
    });
    
    if (isCurrentlyPlaying) {
      // Pause current audio
      if (audioRefs.current[cardId]) {
        audioRefs.current[cardId].pause();
        // Stop tracking listening time
        if (listeningStartTimeRef.current[cardId]) {
          const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current[cardId]) / 1000);
          if (elapsed > 0) {
            handleTrackListening(elapsed);
          }
          listeningStartTimeRef.current[cardId] = 0;
        }
        if (listeningIntervalRef.current[cardId]) {
          clearInterval(listeningIntervalRef.current[cardId]);
          delete listeningIntervalRef.current[cardId];
        }
      }
      setPlayingAudioId(null);
    } else {
      // Play audio
      if (!audioRefs.current[cardId]) {
        audioRefs.current[cardId] = new Audio(card.audio_url);
        
        // Setup play listener for listening session tracking
        audioRefs.current[cardId].addEventListener('play', () => {
          if (!hasIncrementedListeningSessionRef.current[cardId] && user?.uid) {
            hasIncrementedListeningSessionRef.current[cardId] = true;
            apiIncrementListeningSession().catch(err => {
              console.warn('Failed to increment listening session:', err);
            });
          }
        });
        
        // Setup ended listener
        audioRefs.current[cardId].addEventListener('ended', () => {
          setPlayingAudioId(null);
          hasIncrementedListeningSessionRef.current[cardId] = false;
          // Stop tracking listening time
          if (listeningStartTimeRef.current[cardId]) {
            const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current[cardId]) / 1000);
            if (elapsed > 0) {
              handleTrackListening(elapsed);
            }
            listeningStartTimeRef.current[cardId] = 0;
          }
          if (listeningIntervalRef.current[cardId]) {
            clearInterval(listeningIntervalRef.current[cardId]);
            delete listeningIntervalRef.current[cardId];
          }
        });
      } else {
        audioRefs.current[cardId].src = card.audio_url;
      }
      
      audioRefs.current[cardId].play().catch(err => console.warn('Audio play failed:', err));
      setPlayingAudioId(cardId);
      
      // Start tracking listening time
      listeningStartTimeRef.current[cardId] = Date.now();
      listeningIntervalRef.current[cardId] = setInterval(() => {
        if (listeningStartTimeRef.current[cardId]) {
          const elapsed = (Date.now() - listeningStartTimeRef.current[cardId]) / 1000;
          if (elapsed >= 5) {
            handleTrackListening(5);
            listeningStartTimeRef.current[cardId] = Date.now(); // Reset for next interval
          }
        }
      }, 5000);
    }
  }, [playingAudioId, user?.uid, handleTrackListening]);

  // Handle hover on table row for reading time tracking
  const handleTableRowMouseEnter = useCallback((card: CardDoc) => {
    if (!card.id) return;
    
    // Start tracking reading time
    readingStartTimeRef.current[card.id] = Date.now();
    readingIntervalRef.current[card.id] = setInterval(() => {
      if (readingStartTimeRef.current[card.id]) {
        const elapsed = (Date.now() - readingStartTimeRef.current[card.id]) / 1000;
        if (elapsed >= 8) {
          handleTrackReading(8);
          readingStartTimeRef.current[card.id] = Date.now(); // Reset for next interval
        }
      }
    }, 8000);
  }, [handleTrackReading]);

  const handleTableRowMouseLeave = useCallback((card: CardDoc) => {
    if (!card.id) return;
    
    // Stop tracking reading time and report final time
    if (readingStartTimeRef.current[card.id]) {
      const elapsed = Math.floor((Date.now() - readingStartTimeRef.current[card.id]) / 1000);
      if (elapsed > 0) {
        handleTrackReading(elapsed);
      }
      readingStartTimeRef.current[card.id] = 0;
    }
    if (readingIntervalRef.current[card.id]) {
      clearInterval(readingIntervalRef.current[card.id]);
      delete readingIntervalRef.current[card.id];
    }
  }, [handleTrackReading]);

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

  // Load streak history for heatmap
  useEffect(() => {
    if (!user?.uid) return;

    let mounted = true;
    (async () => {
      try {
        const history = await apiGetStreakHistory(user.uid);
        if (mounted) {
          setStreakHistory(history);
        }
      } catch (error) {
        console.error('Failed to load streak history:', error);
        if (mounted) {
          setStreakHistory([]);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid]);

  // Load monthly XP data for graph
  useEffect(() => {
    if (!user?.uid) return;

    let mounted = true;
    (async () => {
      try {
        const data = await apiGetMonthlyXP(user.uid, currentMonth.year, currentMonth.month);
        if (mounted) {
          setMonthlyXPData(data);
        }
      } catch (error) {
        console.error('Failed to load monthly XP:', error);
        if (mounted) {
          setMonthlyXPData([]);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid, currentMonth.year, currentMonth.month]);

  // Load detailed metrics
  useEffect(() => {
    if (!user?.uid) return;

    let mounted = true;
    (async () => {
      try {
        setMetricsLoading(true);
        const data = await apiGetUserMetrics(user.uid);
        if (mounted) {
          setMetrics(data);
        }
      } catch (error) {
        console.error('Failed to load metrics:', error);
        if (mounted) {
          setMetrics(null);
        }
      } finally {
        if (mounted) {
          setMetricsLoading(false);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(tableSearchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [tableSearchQuery]);

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

  // Load saved cards (after allItems is loaded) - use performRefreshSavedCards to avoid duplicate API calls
  // Reset to page 1 when user, allItems, or main_language changes
  useEffect(() => {
    if (!user?.uid || allItems.length === 0) return;
    
    // Reset to page 1 when user, allItems, or main_language changes
    setCurrentPage(1);
  }, [user?.uid, allItems.length, preferences?.main_language]);

  // Load cards when page changes (including initial load)
  // Also reload when main_language changes to ensure cards are filtered correctly
  useEffect(() => {
    if (!user?.uid || allItems.length === 0) return;
    performRefreshSavedCards(currentPage);
  }, [currentPage, user?.uid, allItems.length, preferences?.main_language]);

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

  // Removed content counts calculation - too expensive when user has many cards
  // FilterPanel will only show content items that user has saved cards for

  // Load all unique content IDs that user has saved cards for (for FilterPanel)
  // This loads a few pages to get unique content_ids without loading all cards
  useEffect(() => {
    if (!user?.uid) return;
    
    let cancelled = false;
    
    (async () => {
        try {
          const contentIdsSet = new Set<string>();
        let page = 1;
        const MAX_PAGES_TO_SCAN = 20; // Scan up to 20 pages to get unique content_ids (1000 cards)
        let hasMore = true;
        
        // Load pages until we've seen enough or no more cards
        while (hasMore && page <= MAX_PAGES_TO_SCAN && !cancelled) {
          const result = await apiGetSavedCards(user.uid, page, CARDS_PER_PAGE);
          
          if (result.cards && result.cards.length > 0) {
            result.cards.forEach((card: any) => {
            if (card.film_id) {
                contentIdsSet.add(card.film_id);
              }
            });
            
            hasMore = result.has_more || false;
            page++;
            
            // Small delay to avoid overwhelming the worker
            if (hasMore && page <= MAX_PAGES_TO_SCAN) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } else {
            hasMore = false;
          }
        }
          
          if (!cancelled) {
          setAllSavedContentIds(Array.from(contentIdsSet));
          }
        } catch (error) {
        console.error('Failed to load content IDs:', error);
          if (!cancelled) {
          setAllSavedContentIds([]);
          }
        }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Close SRS dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      Object.keys(srsDropdownRefs.current).forEach((cardId) => {
        const ref = srsDropdownRefs.current[cardId];
        if (ref && !ref.contains(event.target as Node)) {
          setSrsDropdownOpen(prev => ({ ...prev, [cardId]: false }));
        }
      });
      
      // Close Group By dropdown
      if (groupByDropdownRef.current && !groupByDropdownRef.current.contains(event.target as Node)) {
        setGroupByDropdownOpen(false);
        setGroupByDropdownPosition(null);
      }
      
      // Close Columns dropdown
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(event.target as Node)) {
        setColumnsDropdownOpen(false);
        setColumnsDropdownPosition(null);
      }
    };
    
    if (Object.values(srsDropdownOpen).some(open => open) || groupByDropdownOpen || columnsDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [srsDropdownOpen, groupByDropdownOpen, columnsDropdownOpen]);
  
  // Update dropdown positions on scroll (throttled for performance)
  useEffect(() => {
    let rafId: number | null = null;
    const updateDropdownPositions = () => {
      if (rafId) return; // Skip if already scheduled
      
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (groupByDropdownOpen && groupByDropdownRef.current) {
          const rect = groupByDropdownRef.current.getBoundingClientRect();
          setGroupByDropdownPosition({
            top: rect.bottom + 4,
            left: rect.left
          });
        }
        if (columnsDropdownOpen && columnsDropdownRef.current) {
          const rect = columnsDropdownRef.current.getBoundingClientRect();
          setColumnsDropdownPosition({
            top: rect.bottom + 4,
            left: rect.left
          });
        }
      });
    };

    if (groupByDropdownOpen || columnsDropdownOpen) {
      // Use scroll with capture phase and passive for better performance
      window.addEventListener('scroll', updateDropdownPositions, { capture: true, passive: true });
      window.addEventListener('resize', updateDropdownPositions, { passive: true });
      return () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        window.removeEventListener('scroll', updateDropdownPositions, { capture: true } as any);
        window.removeEventListener('resize', updateDropdownPositions);
      };
    }
  }, [groupByDropdownOpen, columnsDropdownOpen]);
  
  // Calculate dropdown position when opening
  const handleGroupByToggle = () => {
    const newState = !groupByDropdownOpen;
    setGroupByDropdownOpen(newState);
    setColumnsDropdownOpen(false);
    
    if (newState && groupByDropdownRef.current) {
      const rect = groupByDropdownRef.current.getBoundingClientRect();
      setGroupByDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      });
    } else {
      setGroupByDropdownPosition(null);
    }
  };
  
  const handleColumnsToggle = () => {
    const newState = !columnsDropdownOpen;
    setColumnsDropdownOpen(newState);
    setGroupByDropdownOpen(false);
    
    if (newState && columnsDropdownRef.current) {
      const rect = columnsDropdownRef.current.getBoundingClientRect();
      setColumnsDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      });
    } else {
      setColumnsDropdownPosition(null);
    }
  };

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
      
      // Refresh saved cards and portfolio for real-time updates
      await Promise.all([
        refreshSavedCards(),
        refreshPortfolio()
      ]);
      
      setSrsDropdownOpen(prev => ({ ...prev, [card.id]: false }));
    } catch (error) {
      console.error('Failed to update SRS state:', error);
    }
  }, [user?.uid, refreshSavedCards, refreshPortfolio]);

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

  // Filter and group saved cards by content filter, main language, and group by option
  const filteredSavedCards = useMemo(() => {
    let filtered = savedCards;

    // Filter by main language FIRST (before other filters)
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

    // Filter by table search query (debounced, only search Main Subtitle)
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(card => {
        const mainLang = preferences?.main_language || 'en';
        const subtitle = card.subtitle?.[mainLang] || card.sentence || '';
        return subtitle.toLowerCase().includes(query);
      });
    }

    // Group by Save Date if selected
    if (groupBy === 'save_date') {
      // Group cards by created_at (Save Date) - group by date (YYYY-MM-DD)
      // Use state_created_at (when user saved card) which is now in created_at field
      const grouped = new Map<string, typeof filtered>();
      filtered.forEach(card => {
        const createdAt = (card as any).created_at;
        if (createdAt && typeof createdAt === 'number') {
          // createdAt is in milliseconds (Unix timestamp * 1000)
          const date = new Date(createdAt);
          // Use UTC date to avoid timezone issues
          const year = date.getUTCFullYear();
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          const dateKey = `${year}-${month}-${day}`; // YYYY-MM-DD in UTC
          if (!grouped.has(dateKey)) {
            grouped.set(dateKey, []);
          }
          grouped.get(dateKey)!.push(card);
        } else {
          // Cards without created_at go to "Unknown" group
          if (!grouped.has('unknown')) {
            grouped.set('unknown', []);
          }
          grouped.get('unknown')!.push(card);
        }
      });
      
      // Sort groups by date (newest first), with "unknown" at the end
      const sortedGroups = Array.from(grouped.entries()).sort((a, b) => {
        if (a[0] === 'unknown') return 1;
        if (b[0] === 'unknown') return -1;
        return b[0].localeCompare(a[0]); // Descending order (newest first)
      });
      
      // Return grouped structure - will be handled in render
      return { grouped: sortedGroups, isGrouped: true };
    }

    return { cards: filtered, isGrouped: false };
  }, [savedCards, preferences?.main_language, allItems, contentFilter, debouncedSearchQuery, groupBy]);
  
  // Calculate filtered count for pagination display
  const filteredCount = useMemo(() => {
    if (filteredSavedCards.isGrouped && filteredSavedCards.grouped) {
      return filteredSavedCards.grouped.reduce((sum, [_, cards]) => sum + cards.length, 0);
    }
    return filteredSavedCards.cards?.length || 0;
  }, [filteredSavedCards]);
  
  // Helper to format date for display
  const formatGroupDate = (dateKey: string): string => {
    if (dateKey === 'unknown') return 'Unknown';
    const date = new Date(dateKey);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  
  // Toggle collapse for a date group
  const toggleGroupCollapse = useCallback((dateKey: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateKey)) {
        newSet.delete(dateKey);
      } else {
        newSet.add(dateKey);
      }
      return newSet;
    });
  }, []);

  // Get all available subtitle languages from savedCards
  const availableSubtitleLanguages = useMemo(() => {
    const langSet = new Set<string>();
    savedCards.forEach(card => {
      if (card.subtitle) {
        Object.keys(card.subtitle).forEach(lang => langSet.add(lang));
      }
    });
    // Sort by language code
    return Array.from(langSet).sort();
  }, [savedCards]);

  // Helper to calculate SRS Interval in days from next_review_at
  const calculateIntervalDays = useCallback((nextReviewAt: number | null | undefined): number | null => {
    if (!nextReviewAt || typeof nextReviewAt !== 'number') return null;
    const now = Date.now();
    const diffMs = nextReviewAt - now;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }, []);

  // Grouped columns structure for dropdown
  const columnGroups = useMemo(() => {
    const mainLang = preferences?.main_language || 'en';
    
    // Exclude main language from subtitle languages list
    const subtitleLangs = availableSubtitleLanguages.filter(lang => lang !== mainLang);
    
    return [
      {
        label: 'Image & Subtitle Language',
        columns: [
          'Image',
          ...subtitleLangs.map(lang => `Subtitle (${langLabel(lang)})`)
        ]
      },
      {
        label: 'Date',
        columns: ['Save Date', 'Updated Date', 'Due Date']
      },
      {
        label: 'Tag',
        columns: ['Level', 'Media']
      },
      {
        label: 'SRS System',
        columns: ['SRS State', 'Interval']
      },
      {
        label: 'XP Count',
        columns: [
          'XP Count',
          'XP Count (Reading)',
          'XP Count (Listening)',
          'XP Count (Speaking)',
          'XP Count (Writing)'
        ]
      }
    ];
  }, [availableSubtitleLanguages, preferences?.main_language]);

  // Build maps for FilterPanel - include all saved content IDs that match main_language
  // This ensures FilterPanel shows all content items user has saved
  const filmTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    const mainLang = preferences?.main_language || "en";
    const savedContentIdsSet = new Set(allSavedContentIds);
    
    // Add all items from allItems that match main_language and are in allSavedContentIds
    allItems.forEach((item) => {
      if (item.id && savedContentIdsSet.has(item.id) && item.main_language === mainLang) {
        map[item.id] = item.title || item.id;
      }
    });
    
    return map;
  }, [allItems, allSavedContentIds, preferences?.main_language]);

  const filmTypeMap = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    const mainLang = preferences?.main_language || "en";
    const savedContentIdsSet = new Set(allSavedContentIds);
    
    // Add all items from allItems that match main_language and are in allSavedContentIds
    allItems.forEach((item) => {
      if (item.id && savedContentIdsSet.has(item.id) && item.main_language === mainLang) {
        map[item.id] = item.type;
      }
    });
    
    return map;
  }, [allItems, allSavedContentIds, preferences?.main_language]);

  const filmLangMap = useMemo(() => {
    const map: Record<string, string> = {};
    const mainLang = preferences?.main_language || "en";
    const savedContentIdsSet = new Set(allSavedContentIds);
    
    // Add all items from allItems that match main_language and are in allSavedContentIds
    allItems.forEach((item) => {
      if (item.id && item.main_language && savedContentIdsSet.has(item.id) && item.main_language === mainLang) {
        map[item.id] = item.main_language;
      }
    });
    
    return map;
  }, [allItems, allSavedContentIds, preferences?.main_language]);

  const filmStatsMap = useMemo(() => {
    const map: Record<string, LevelFrameworkStats | null> = {};
    const mainLang = preferences?.main_language || "en";
    const savedContentIdsSet = new Set(allSavedContentIds);
    
    // Add all items from allItems that match main_language and are in allSavedContentIds
    allItems.forEach((item) => {
      if (item.id && savedContentIdsSet.has(item.id) && item.main_language === mainLang) {
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
  }, [allItems, allSavedContentIds, preferences?.main_language]);

  // Use allSavedContentIds filtered by main_language for FilterPanel
  // This ensures FilterPanel shows all content items user has saved that match main_language
  // We need to check main_language from allItems, but include all matching items
  const savedContentIds = useMemo(() => {
    const mainLang = preferences?.main_language || "en";
    const savedContentIdsSet = new Set(allSavedContentIds);
    
    // Get all items from allItems that:
    // 1. Are in allSavedContentIds (user has saved cards)
    // 2. Have matching main_language
    const matchingIds = allItems
      .filter(item => {
        const hasSavedCards = savedContentIdsSet.has(item.id);
        const matchesLanguage = item.main_language === mainLang;
        return hasSavedCards && matchesLanguage;
      })
      .map(item => item.id)
      .filter((id): id is string => !!id);
    
    return matchingIds;
  }, [allItems, allSavedContentIds, preferences?.main_language]);

  // Process monthly XP data for graph
  const xpProgressData = useMemo(() => {
    if (monthlyXPData.length === 0) return [];
    return monthlyXPData.map(item => item.xp_earned || 0);
  }, [monthlyXPData]);

  // Calculate max XP for scaling
  const maxXP = useMemo(() => {
    if (xpProgressData.length === 0) return 1;
    return Math.max(...xpProgressData, 1);
  }, [xpProgressData]);

  const scaleFactor = maxXP > 0 ? 200 / maxXP : 1;

  // Generate date labels for current month
  const dateLabels = useMemo(() => {
    const year = currentMonth.year;
    const month = currentMonth.month;
    const daysInMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
    
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = new Date(year, month - 1, day);
      const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
      const isToday = isCurrentMonth && day === today.getDate();
      return { 
        label: `${monthStr} ${day}`, 
        isToday: isToday,
        date: date,
        day: day
      };
    });
  }, [currentMonth]);

  // Generate visible date labels (2, 5, 8, 11... up to 29)
  // Always include today's date if viewing current month (for Today line)
  const visibleDateLabels = useMemo(() => {
    const filtered = dateLabels.filter(date => {
      const day = date.day;
      // Show days: 2, 5, 8, 11, 14, 17, 20, 23, 26, 29
      return (day - 2) % 3 === 0 && day <= 29;
    });
    
    // Always include today's date if it's in the current month and not already in the list
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === currentMonth.year && today.getMonth() + 1 === currentMonth.month;
    if (isCurrentMonth) {
      const todayDay = today.getDate();
      const todayDateLabel = dateLabels.find(d => d.day === todayDay);
      if (todayDateLabel && !filtered.find(d => d.day === todayDay)) {
        filtered.push(todayDateLabel);
        // Sort by day to maintain order
        filtered.sort((a, b) => a.day - b.day);
      }
    }
    
    return filtered;
  }, [dateLabels, currentMonth]);

  // Process streak history for heatmap
  const streakMap = useMemo(() => {
    const map = new Map<string, { achieved: boolean; count: number }>();
    streakHistory.forEach(item => {
      map.set(item.streak_date, {
        achieved: item.streak_achieved === 1,
        count: item.streak_count || 0
      });
    });
    return map;
  }, [streakHistory]);

  // Calculate heatmap squares (30 columns x 7 rows = 210 days, ~7 months)
  const heatmapSquares = useMemo(() => {
    const squares: Array<{ date: string; achieved: boolean; count: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Generate 210 days going backwards from today
    for (let i = 209; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const streakData = streakMap.get(dateStr);
      
      squares.push({
        date: dateStr,
        achieved: streakData?.achieved || false,
        count: streakData?.count || 0
      });
    }
    
    return squares;
  }, [streakMap]);

  // Helper function to get metric value and label
  const getMetricValue = useCallback((cardIndex: number): { value: number | string; label: string } => {
    if (!metrics || metricsLoading) {
      // Fallback to portfolio data
      if (!portfolio) return { value: 0, label: '' };
      if (cardIndex === 0) return { value: portfolio.due_cards_count || 0, label: '# Due Cards' };
      if (cardIndex === 1) return { value: Math.round(portfolio.total_listening_time / 60), label: 'Listening Time (min)' };
      if (cardIndex === 2) return { value: Math.round(portfolio.total_reading_time / 60), label: 'Reading Time (min)' };
      return { value: 0, label: '' };
    }

    const metricType = selectedMetricTypes[cardIndex];
    const metricKey = selectedMetrics[cardIndex] || 'due_cards';

    if (metricType === 'srs') {
      const srsMetric = metrics.srs_metrics[metricKey as keyof typeof metrics.srs_metrics];
      const labels: Record<string, string> = {
        new_cards: '# New Cards',
        again_cards: '# Again Cards',
        hard_cards: '# Hard Cards',
        good_cards: '# Good Cards',
        easy_cards: '# Easy Cards',
        due_cards: '# Due Cards',
        average_interval_days: 'Average Interval (days)'
      };
      const value = typeof srsMetric === 'number' ? srsMetric : 0;
      return {
        value: metricKey === 'average_interval_days' ? value.toFixed(2) : value,
        label: labels[metricKey] || metricKey
      };
    } else if (metricType === 'listening') {
      const listeningMetric = metrics.listening_metrics[metricKey as keyof typeof metrics.listening_metrics];
      const labels: Record<string, string> = {
        time_minutes: 'Listening Time (min)',
        count: 'Listening Count',
        xp: 'Listening XP'
      };
      return {
        value: typeof listeningMetric === 'number' ? listeningMetric : 0,
        label: labels[metricKey] || metricKey
      };
    } else if (metricType === 'reading') {
      const readingMetric = metrics.reading_metrics[metricKey as keyof typeof metrics.reading_metrics];
      const labels: Record<string, string> = {
        time_minutes: 'Reading Time (min)',
        count: 'Review Count',
        xp: 'Reading XP'
      };
      return {
        value: typeof readingMetric === 'number' ? readingMetric : 0,
        label: labels[metricKey] || metricKey
      };
    }

    return { value: 0, label: '' };
  }, [metrics, metricsLoading, portfolio, selectedMetricTypes, selectedMetrics]);

  // Dropdown options for each metric type
  const srsOptions = [
    { key: 'new_cards', label: '# New Cards' },
    { key: 'again_cards', label: '# Again Cards' },
    { key: 'hard_cards', label: '# Hard Cards' },
    { key: 'good_cards', label: '# Good Cards' },
    { key: 'easy_cards', label: '# Easy Cards' },
    { key: 'due_cards', label: '# Due Cards' },
    { key: 'average_interval_days', label: 'Average Interval (days)' }
  ];

  const listeningOptions = [
    { key: 'time_minutes', label: 'Listening Time (min)' },
    { key: 'count', label: 'Listening Count' },
    { key: 'xp', label: 'Listening XP' }
  ];

  const readingOptions = [
    { key: 'time_minutes', label: 'Reading Time (min)' },
    { key: 'count', label: 'Review Count' },
    { key: 'xp', label: 'Reading XP' }
  ];

  // State for dropdown open/close
  const [metricDropdownOpen, setMetricDropdownOpen] = useState<Record<number, boolean>>({});
  const metricDropdownRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      Object.keys(metricDropdownRefs.current).forEach((cardIndex) => {
        const ref = metricDropdownRefs.current[parseInt(cardIndex)];
        if (ref && !ref.contains(event.target as Node)) {
          setMetricDropdownOpen(prev => ({ ...prev, [cardIndex]: false }));
        }
      });
    };
    
    if (Object.values(metricDropdownOpen).some(open => open)) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [metricDropdownOpen]);

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
        allResults={filteredSavedCards.isGrouped && filteredSavedCards.grouped ? filteredSavedCards.grouped.flatMap(([_, cards]) => cards) : (filteredSavedCards.cards || [])}
        contentCounts={undefined}
        totalCount={filteredSavedCards.isGrouped && filteredSavedCards.grouped ? filteredSavedCards.grouped.reduce((sum, [_, cards]) => sum + cards.length, 0) : (filteredSavedCards.cards?.length || 0)}
        allContentIds={savedContentIds}
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
        {/* SRS Metrics Card */}
        <div className="portfolio-metric-card" style={{ position: 'relative' }} ref={(el) => { if (el && metricDropdownRefs.current) metricDropdownRefs.current[0] = el; }}>
          <div className="portfolio-metric-value">
            {getMetricValue(0).value}
          </div>
          <div 
            className="portfolio-metric-label"
            style={{ cursor: 'pointer', position: 'relative' }}
            onClick={(e) => {
              e.stopPropagation();
              setMetricDropdownOpen(prev => ({ ...prev, 0: !prev[0] }));
            }}
          >
            <span>{getMetricValue(0).label}</span>
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
            {metricDropdownOpen[0] && (
              <div 
                className="portfolio-metric-dropdown"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: '200px',
                  marginTop: '8px',
                  background: 'var(--background)',
                  border: '1px solid var(--neutral)',
                  borderRadius: '8px',
                  padding: '8px',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {srsOptions.map(option => (
                  <button
                    key={option.key}
                    className="portfolio-metric-dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: selectedMetrics[0] === option.key ? 'var(--primary)' : 'transparent',
                      color: selectedMetrics[0] === option.key ? '#fff' : 'var(--text)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={() => {
                      setSelectedMetrics(prev => { const newArr = [...prev]; newArr[0] = option.key; return newArr; });
                      setMetricDropdownOpen(prev => ({ ...prev, 0: false }));
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Listening Metrics Card */}
        <div className="portfolio-metric-card" style={{ position: 'relative' }} ref={(el) => { if (el && metricDropdownRefs.current) metricDropdownRefs.current[1] = el; }}>
          <div className="portfolio-metric-value">
            {typeof getMetricValue(1).value === 'number' ? getMetricValue(1).value.toLocaleString() : getMetricValue(1).value}
          </div>
          <div 
            className="portfolio-metric-label"
            style={{ cursor: 'pointer', position: 'relative' }}
            onClick={(e) => {
              e.stopPropagation();
              setMetricDropdownOpen(prev => ({ ...prev, 1: !prev[1] }));
            }}
          >
            <span>{getMetricValue(1).label}</span>
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
            {metricDropdownOpen[1] && (
              <div 
                className="portfolio-metric-dropdown"
            style={{ 
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: '200px',
                  marginTop: '8px',
                  background: 'var(--background)',
                  border: '1px solid var(--neutral)',
                  borderRadius: '8px',
                  padding: '8px',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {listeningOptions.map(option => (
                  <button
                    key={option.key}
                    className="portfolio-metric-dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: selectedMetrics[1] === option.key ? 'var(--primary)' : 'transparent',
                      color: selectedMetrics[1] === option.key ? '#fff' : 'var(--text)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={() => {
                      setSelectedMetrics(prev => { const newArr = [...prev]; newArr[1] = option.key; return newArr; });
                      setMetricDropdownOpen(prev => ({ ...prev, 1: false }));
            }}
          >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Reading Metrics Card */}
        <div className="portfolio-metric-card" style={{ position: 'relative' }} ref={(el) => { if (el && metricDropdownRefs.current) metricDropdownRefs.current[2] = el; }}>
          <div className="portfolio-metric-value">
            {typeof getMetricValue(2).value === 'number' ? getMetricValue(2).value.toLocaleString() : getMetricValue(2).value}
          </div>
          <div 
            className="portfolio-metric-label"
            style={{ cursor: 'pointer', position: 'relative' }}
            onClick={(e) => {
              e.stopPropagation();
              setMetricDropdownOpen(prev => ({ ...prev, 2: !prev[2] }));
            }}
          >
            <span>{getMetricValue(2).label}</span>
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
            {metricDropdownOpen[2] && (
              <div 
                className="portfolio-metric-dropdown"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: '200px',
                  marginTop: '8px',
                  background: 'var(--background)',
                  border: '1px solid var(--neutral)',
                  borderRadius: '8px',
                  padding: '8px',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {readingOptions.map(option => (
                  <button
                    key={option.key}
                    className="portfolio-metric-dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: selectedMetrics[2] === option.key ? 'var(--primary)' : 'transparent',
                      color: selectedMetrics[2] === option.key ? '#fff' : 'var(--text)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={() => {
                      setSelectedMetrics(prev => { const newArr = [...prev]; newArr[2] = option.key; return newArr; });
                      setMetricDropdownOpen(prev => ({ ...prev, 2: false }));
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Speaking Attempts Card */}
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">
            {(portfolio?.total_speaking_attempt || 0).toLocaleString()}
          </div>
          <div className="portfolio-metric-label">
            # Speaking Attempts
            <img src={buttonPlayIcon} alt="" className="portfolio-metric-label-icon" />
          </div>
        </div>

        {/* Writing Attempts Card */}
        <div className="portfolio-metric-card">
          <div className="portfolio-metric-value">
            {(portfolio?.total_writing_attempt || 0).toLocaleString()}
          </div>
          <div className="portfolio-metric-label">
            # Writing Attempts
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
              <button 
                className="portfolio-graph-nav-btn"
                onClick={() => {
                  const newMonth = currentMonth.month === 1 ? 12 : currentMonth.month - 1;
                  const newYear = currentMonth.month === 1 ? currentMonth.year - 1 : currentMonth.year;
                  setCurrentMonth({ year: newYear, month: newMonth });
                }}
              >
                <img src={buttonPlayIcon} alt="Previous" className="portfolio-graph-nav-icon portfolio-graph-nav-icon-left" />
              </button>
              <div className="portfolio-graph-month-label">
                {new Date(currentMonth.year, currentMonth.month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
              <button 
                className="portfolio-graph-nav-btn"
                onClick={() => {
                  const today = new Date();
                  const maxMonth = today.getMonth() + 1;
                  const maxYear = today.getFullYear();
                  if (currentMonth.year < maxYear || (currentMonth.year === maxYear && currentMonth.month < maxMonth)) {
                    const newMonth = currentMonth.month === 12 ? 1 : currentMonth.month + 1;
                    const newYear = currentMonth.month === 12 ? currentMonth.year + 1 : currentMonth.year;
                    setCurrentMonth({ year: newYear, month: newMonth });
                  }
                }}
                disabled={currentMonth.year === new Date().getFullYear() && currentMonth.month === new Date().getMonth() + 1}
              >
                <img src={buttonPlayIcon} alt="Next" className="portfolio-graph-nav-icon" />
              </button>
            </div>
          </div>
          <div className="portfolio-graph-container">
            {/* Tooltip for chart points */}
            <div id="xp-chart-tooltip" className="portfolio-xp-chart-tooltip" />
            <div className="portfolio-graph-placeholder">
              {xpProgressData.length > 0 ? (
                <svg width="100%" height="100%" viewBox="30 -20 1020 270" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0 }}>
                {[0, 25, 50, 75, 100].map((y) => (
                    <line key={y} x1="40" y1={y * 2} x2="1040" y2={y * 2} stroke="var(--neutral)" strokeWidth="0.5" opacity="0.3" />
                ))}
                  <polygon
                    points={`40,200 ${xpProgressData.map((value, i) => {
                      const x = dateLabels.length > 1 ? 40 + (i / (dateLabels.length - 1)) * 1000 : 40;
                      const y = 200 - (value * scaleFactor);
                      return `${x},${y}`;
                    }).join(' ')},${dateLabels.length > 1 ? 1040 : 40},200`}
                    fill="var(--primary)"
                    opacity="0.2"
                  />
                <polyline
                    points={xpProgressData.map((value, i) => {
                      const x = dateLabels.length > 1 ? 40 + (i / (dateLabels.length - 1)) * 1000 : 40;
                      const y = 200 - (value * scaleFactor);
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                />
                  {xpProgressData.map((value, i) => {
                    const x = dateLabels.length > 1 ? 40 + (i / (dateLabels.length - 1)) * 1000 : 40;
                    const y = 200 - (value * scaleFactor);
                    const dateLabel = dateLabels[i];
                    const day = dateLabel?.day || i + 1;
                    const monthStr = dateLabel?.date ? dateLabel.date.toLocaleDateString('en-US', { month: 'short' }) : '';
                  return (
                      <g key={i}>
                        <rect 
                          x={x - 2.5} 
                          y={y - 2.5} 
                          width="5" 
                          height="5" 
                          fill="var(--chart-dot-fill)" 
                          stroke="var(--chart-dot-stroke)" 
                          strokeWidth="0.8"
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => {
                            const tooltip = document.getElementById('xp-chart-tooltip');
                            if (tooltip) {
                              tooltip.textContent = `${monthStr} ${day}: ${value.toLocaleString()} XP`;
                              tooltip.style.display = 'block';
                              tooltip.style.left = `${e.clientX + 10}px`;
                              tooltip.style.top = `${e.clientY - 30}px`;
                            }
                          }}
                          onMouseMove={(e) => {
                            const tooltip = document.getElementById('xp-chart-tooltip');
                            if (tooltip) {
                              tooltip.style.left = `${e.clientX + 10}px`;
                              tooltip.style.top = `${e.clientY - 30}px`;
                            }
                          }}
                          onMouseLeave={() => {
                            const tooltip = document.getElementById('xp-chart-tooltip');
                            if (tooltip) {
                              tooltip.style.display = 'none';
                            }
                          }}
                        />
                      </g>
                  );
                })}
                  {visibleDateLabels.map((date) => {
                    const originalIdx = dateLabels.indexOf(date);
                    const x = dateLabels.length > 1 ? 40 + (originalIdx / (dateLabels.length - 1)) * 1000 : 40;
                  return (
                      <g key={originalIdx}>
                      {date.isToday && (
                        <line x1={x} y1="0" x2={x} y2="200" stroke="var(--hover-select)" strokeWidth="1.5" />
                      )}
                      {!date.isToday && (
                        <text 
                          x={x} 
                          y="240" 
                          textAnchor="middle" 
                          className="portfolio-graph-date-label"
                          fill="var(--text)"
                        >
                          {date.label}
                        </text>
                      )}
                      {date.isToday && (
                        <text x={x} y="-5" textAnchor="middle" className="portfolio-graph-today-label">Today</text>
                      )}
                    </g>
                  );
                })}
              </svg>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--neutral)' }}>
                  No data available
            </div>
              )}
          </div>
        </div>
            </div>
            </div>

      {/* Heatmap Section - Hidden for now */}
      <div className="portfolio-heatmap-section" style={{ display: 'none' }}>
        <div 
          ref={gridRef} 
          className="portfolio-grid-pattern" 
          style={{ 
            width: gridWidth,
            gridTemplateColumns: `repeat(${gridCols}, ${squareSize}px)`,
            gridTemplateRows: `repeat(${gridRows}, ${squareSize}px)`
          }}
        >
          {heatmapSquares.slice(0, gridSquares).map((square) => {
            let colorClass = 'neutral';
            if (square.achieved) {
              // Use streak count to determine intensity
              if (square.count >= 30) {
                colorClass = 'hover-select'; // High streak
              } else if (square.count >= 7) {
                colorClass = 'primary'; // Medium streak
              } else {
                colorClass = 'neutral'; // Low streak (but achieved)
              }
            } else {
              colorClass = 'neutral'; // No streak
            }
                  return (
              <div 
                key={square.date} 
                className={`portfolio-grid-square portfolio-grid-square-${colorClass}`}
                title={`${square.date}: ${square.achieved ? `Streak ${square.count} days` : 'No streak'}`}
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
            <div className="portfolio-table-dropdown-wrapper" ref={groupByDropdownRef}>
              <button
                className="portfolio-table-dropdown-btn"
                onClick={handleGroupByToggle}
              >
                <span>Group By</span>
                {groupBy === 'save_date' && (
                  <span className="portfolio-table-dropdown-info">Save Date</span>
                )}
                <img src={buttonPlayIcon} alt="" className={groupByDropdownOpen ? 'rotate-90' : ''} />
              </button>
              {groupByDropdownOpen && groupByDropdownPosition && (
                <div 
                  className="portfolio-table-dropdown-menu"
                  style={{
                    top: `${groupByDropdownPosition.top}px`,
                    left: `${groupByDropdownPosition.left}px`
                  }}
                >
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
            <div className="portfolio-table-dropdown-wrapper" ref={columnsDropdownRef}>
              <button
                className="portfolio-table-dropdown-btn"
                onClick={handleColumnsToggle}
              >
                <span>Columns</span>
                <span className="portfolio-table-dropdown-info">{selectedColumns.size}</span>
                <img src={buttonPlayIcon} alt="" className={columnsDropdownOpen ? 'rotate-90' : ''} />
              </button>
              {columnsDropdownOpen && columnsDropdownPosition && (
                <div 
                  className="portfolio-table-dropdown-menu"
                  style={{
                    top: `${columnsDropdownPosition.top}px`,
                    left: `${columnsDropdownPosition.left}px`,
                    maxHeight: '500px',
                    overflowY: 'auto'
                  }}
                >
                  {columnGroups.map((group, groupIdx) => (
                    <div key={groupIdx}>
                      <div 
                        className="portfolio-table-dropdown-group-label"
                        style={{
                          padding: '8px 12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: 'var(--sub-language-text)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          borderBottom: groupIdx < columnGroups.length - 1 ? '1px solid var(--hover-bg)' : 'none'
                        }}
                      >
                        {group.label}
                      </div>
                      {group.columns.map((col) => {
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
                            style={{
                              paddingLeft: '24px'
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
                  ))}
            </div>
              )}
          </div>
        </div>
          <button 
            className="portfolio-table-practice-btn typography-pressstart-1"
            onClick={handlePracticeClick}
            disabled={selectedCards.size === 0}
          >
            Practice{selectedCards.size > 0 ? ` (${selectedCards.size})` : ''}
          </button>
        </div>
        <div className="portfolio-table-container">
          <table className="portfolio-saved-cards-table">
            <thead>
              <tr>
                {selectedColumns.has('Main Subtitle') && <th>Main Subtitle</th>}
                {selectedColumns.has('Image') && <th>Image</th>}
                {availableSubtitleLanguages.filter(lang => {
                  const mainLang = preferences?.main_language || 'en';
                  return lang !== mainLang && selectedColumns.has(`Subtitle (${langLabel(lang)})`);
                }).map(lang => (
                  <th key={lang}>Subtitle ({langLabel(lang)})</th>
                ))}
                {selectedColumns.has('Save Date') && <th>Save Date</th>}
                {selectedColumns.has('Updated Date') && <th>Updated Date</th>}
                {selectedColumns.has('Level') && <th>Level</th>}
                {selectedColumns.has('Media') && <th>Media</th>}
                {selectedColumns.has('SRS State') && <th>SRS State</th>}
                {selectedColumns.has('Interval') && <th>Interval</th>}
                {selectedColumns.has('Due Date') && <th>Due Date</th>}
                {selectedColumns.has('XP Count') && <th>XP Count</th>}
                {selectedColumns.has('XP Count (Reading)') && <th>XP Count (Reading)</th>}
                {selectedColumns.has('XP Count (Listening)') && <th>XP Count (Listening)</th>}
                {selectedColumns.has('XP Count (Speaking)') && <th>XP Count (Speaking)</th>}
                {selectedColumns.has('XP Count (Writing)') && <th>XP Count (Writing)</th>}
              </tr>
            </thead>
            <tbody>
              {(() => {
                if (filteredSavedCards.isGrouped && filteredSavedCards.grouped) {
                  // Render grouped by date
                  if (filteredSavedCards.grouped.length === 0) {
                  return (
                      <tr>
                        <td colSpan={selectedColumns.size} style={{ textAlign: 'center', padding: '40px', color: 'var(--neutral)' }}>
                          No saved cards found
                        </td>
                      </tr>
                    );
                  }
                  
                  return filteredSavedCards.grouped.map(([dateKey, cards]) => {
                    const isCollapsed = collapsedGroups.has(dateKey);
                    const dateLabel = formatGroupDate(dateKey);
                    
                    return (
                      <React.Fragment key={dateKey}>
                        <tr className="portfolio-table-group-header">
                          <td colSpan={selectedColumns.size} className="portfolio-table-group-header-cell">
                            <button
                              className="portfolio-table-collapse-button"
                              onClick={() => toggleGroupCollapse(dateKey)}
                            >
                              <span>{dateLabel}</span>
                              <img 
                                src={buttonPlayIcon} 
                                alt="" 
                                className={isCollapsed ? '' : 'rotate-90'} 
                                style={{ width: '12px', height: '12px', filter: 'var(--icon-text-filter)' }}
                              />
                            </button>
                          </td>
                        </tr>
                        {!isCollapsed && cards.map((card, cardIdx) => {
                          const film = allItems.find(item => item.id === card.film_id);
                          const mainLang = preferences?.main_language || 'en';
                          const mainSubtitle = card.subtitle?.[mainLang] || card.sentence || '';
                          const srsState = (card as any).srs_state || 'none';
                          const episodeNum = (card as any).episode_number || null;
                          
                          // Create unique key by combining dateKey, film_id, episode_id, and card.id
                          const uniqueKey = `${dateKey}-${card.film_id || ''}-${card.episode_id || ''}-${card.id || cardIdx}`;
                          
                          return (
                            <tr 
                              key={uniqueKey}
                              onMouseEnter={() => handleTableRowMouseEnter(card)}
                              onMouseLeave={() => handleTableRowMouseLeave(card)}
                            >
                      {selectedColumns.has('Main Subtitle') && (
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input 
                              type="checkbox" 
                              className="portfolio-table-checkbox"
                              checked={selectedCards.has(card.id)}
                              onChange={() => toggleCardSelection(card)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div 
                              style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                cursor: card.audio_url ? 'pointer' : 'default',
                                position: 'relative'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (card.audio_url) {
                                  handleTableCardAudioPlay(card);
                                }
                              }}
                              title={card.audio_url ? 'Click to play audio' : ''}
                            >
                              <svg 
                                width="16" 
                                height="16" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                xmlns="http://www.w3.org/2000/svg"
                                style={{ flexShrink: 0 }}
                              >
                                <path 
                                  d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" 
                                  fill="var(--headphone-icon)"
                                />
                              </svg>
                              {playingAudioId === card.id && (
                                <div style={{
                                  position: 'absolute',
                                  top: '-2px',
                                  right: '-2px',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: 'var(--primary)',
                                  animation: 'pulse 1.5s ease-in-out infinite'
                                }} />
                              )}
                            </div>
                            <span 
                              style={{ 
                                display: 'block',
                                whiteSpace: 'normal',
                                wordWrap: 'break-word',
                                maxWidth: '200px'
                              }}
                              title={mainSubtitle}
                            >
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
                      {availableSubtitleLanguages.filter(lang => {
                        const mainLang = preferences?.main_language || 'en';
                        return lang !== mainLang && selectedColumns.has(`Subtitle (${langLabel(lang)})`);
                      }).map(lang => (
                        <td key={lang}>
                          <span 
                            style={{ 
                              display: 'block',
                              whiteSpace: 'normal',
                              wordWrap: 'break-word',
                              maxWidth: '200px'
                            }}
                            title={card.subtitle?.[lang] || ''}
                          >
                            {card.subtitle?.[lang] || <span style={{ color: 'var(--neutral)' }}>-</span>}
                          </span>
                        </td>
                      ))}
                      {selectedColumns.has('Save Date') && (
                        <td>
                          {(() => {
                            const createdAt = (card as any).created_at;
                            if (createdAt && typeof createdAt === 'number') {
                              return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            }
                            return <span style={{ color: 'var(--neutral)' }}>-</span>;
                          })()}
                        </td>
                      )}
                      {selectedColumns.has('Updated Date') && (
                        <td>
                          {(() => {
                            const updatedAt = (card as any).state_updated_at;
                            if (updatedAt && typeof updatedAt === 'number') {
                              return new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            }
                            return <span style={{ color: 'var(--neutral)' }}>-</span>;
                          })()}
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
                      {selectedColumns.has('Interval') && (
                        <td>
                          {(() => {
                            const nextReviewAt = (card as any).next_review_at;
                            const intervalDays = calculateIntervalDays(nextReviewAt);
                            if (intervalDays !== null) {
                              const displayDays = intervalDays < 0 ? `${Math.abs(intervalDays)} days ago` : `${intervalDays} days`;
                              return (
                                <span style={{ color: intervalDays < 0 ? 'var(--primary)' : 'var(--text)' }}>
                                  {displayDays}
                                </span>
                              );
                            }
                            return <span style={{ color: 'var(--neutral)' }}>-</span>;
                          })()}
                        </td>
                      )}
                      {selectedColumns.has('Due Date') && (
                        <td>
                          {(() => {
                            const nextReviewAt = (card as any).next_review_at;
                            if (nextReviewAt && typeof nextReviewAt === 'number') {
                              return new Date(nextReviewAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            }
                            return <span style={{ color: 'var(--neutral)' }}>-</span>;
                          })()}
                        </td>
                      )}
                      {selectedColumns.has('XP Count') && (
                        <td>{(card as any).xp_total || 0} XP</td>
                      )}
                      {selectedColumns.has('XP Count (Reading)') && (
                        <td>{(card as any).xp_reading || 0} XP</td>
                      )}
                      {selectedColumns.has('XP Count (Listening)') && (
                        <td>{(card as any).xp_listening || 0} XP</td>
                      )}
                      {selectedColumns.has('XP Count (Speaking)') && (
                        <td>{(card as any).xp_speaking || 0} XP</td>
                      )}
                      {selectedColumns.has('XP Count (Writing)') && (
                        <td>{(card as any).xp_writing || 0} XP</td>
                      )}
                            </tr>
                  );
                })}
                      </React.Fragment>
                    );
                  });
                } else {
                  // Render ungrouped
                  const cards = filteredSavedCards.cards || [];
                  if (cards.length === 0) {
                    return (
                      <tr>
                        <td colSpan={selectedColumns.size} style={{ textAlign: 'center', padding: '40px', color: 'var(--neutral)' }}>
                          No saved cards found
                        </td>
                      </tr>
                    );
                  }
                  
                  return cards.map((card, idx) => {
                    const film = allItems.find(item => item.id === card.film_id);
                    const mainLang = preferences?.main_language || 'en';
                    const mainSubtitle = card.subtitle?.[mainLang] || card.sentence || '';
                    const srsState = (card as any).srs_state || 'none';
                    const episodeNum = (card as any).episode_number || null;
                    
                    // Create unique key by combining film_id, episode_id, card.id, and index
                    const uniqueKey = `${card.film_id || ''}-${card.episode_id || ''}-${card.id || idx}-${idx}`;
                    
                    return (
                      <tr 
                        key={uniqueKey}
                        onMouseEnter={() => handleTableRowMouseEnter(card)}
                        onMouseLeave={() => handleTableRowMouseLeave(card)}
                      >
                        {selectedColumns.has('Main Subtitle') && (
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input 
                                type="checkbox" 
                                className="portfolio-table-checkbox"
                                checked={selectedCards.has(card.id)}
                                onChange={() => toggleCardSelection(card)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div 
                                style={{ 
                                  display: 'inline-flex', 
                                  alignItems: 'center', 
                                  cursor: card.audio_url ? 'pointer' : 'default',
                                  position: 'relative'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (card.audio_url) {
                                    handleTableCardAudioPlay(card);
                                  }
                                }}
                                title={card.audio_url ? 'Click to play audio' : ''}
                              >
                                <svg 
                                  width="16" 
                                  height="16" 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  xmlns="http://www.w3.org/2000/svg"
                                  style={{ flexShrink: 0 }}
                                >
                                  <path 
                                    d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" 
                                    fill="var(--headphone-icon)"
                                  />
                                </svg>
                                {playingAudioId === card.id && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '-2px',
                                    right: '-2px',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: 'var(--primary)',
                                    animation: 'pulse 1.5s ease-in-out infinite'
                                  }} />
                                )}
                              </div>
                              <span 
                                style={{ 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis', 
                                  whiteSpace: 'nowrap',
                                  maxWidth: '200px'
                                }}
                                title={mainSubtitle}
                              >
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
                        {availableSubtitleLanguages.filter(lang => {
                          const mainLang = preferences?.main_language || 'en';
                          return lang !== mainLang && selectedColumns.has(`Subtitle (${langLabel(lang)})`);
                        }).map(lang => (
                          <td key={lang}>
                            <span 
                              style={{ 
                                display: 'block',
                                whiteSpace: 'normal',
                                wordWrap: 'break-word',
                                maxWidth: '200px'
                              }}
                              title={card.subtitle?.[lang] || ''}
                            >
                              {card.subtitle?.[lang] || <span style={{ color: 'var(--neutral)' }}>-</span>}
                            </span>
                          </td>
                        ))}
                        {selectedColumns.has('Save Date') && (
                          <td>
                            {(() => {
                              const createdAt = (card as any).created_at;
                              if (createdAt && typeof createdAt === 'number') {
                                return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                              }
                              return <span style={{ color: 'var(--neutral)' }}>-</span>;
                            })()}
                          </td>
                        )}
                        {selectedColumns.has('Updated Date') && (
                          <td>
                            {(() => {
                              const updatedAt = (card as any).state_updated_at;
                              if (updatedAt && typeof updatedAt === 'number') {
                                return new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                              }
                              return <span style={{ color: 'var(--neutral)' }}>-</span>;
                            })()}
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
                              if (srsState && srsState !== 'none' && srsState !== '') {
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
                        {selectedColumns.has('Interval') && (
                          <td>
                            {(() => {
                              const nextReviewAt = (card as any).next_review_at;
                              const intervalDays = calculateIntervalDays(nextReviewAt);
                              if (intervalDays !== null) {
                                const displayDays = intervalDays < 0 ? `${Math.abs(intervalDays)} days ago` : `${intervalDays} days`;
                                return (
                                  <span style={{ color: intervalDays < 0 ? 'var(--primary)' : 'var(--text)' }}>
                                    {displayDays}
                                  </span>
                                );
                              }
                              return <span style={{ color: 'var(--neutral)' }}>-</span>;
                            })()}
                          </td>
                        )}
                        {selectedColumns.has('Due Date') && (
                          <td>
                            {(() => {
                              const nextReviewAt = (card as any).next_review_at;
                              if (nextReviewAt && typeof nextReviewAt === 'number') {
                                return new Date(nextReviewAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                              }
                              return <span style={{ color: 'var(--neutral)' }}>-</span>;
                            })()}
                          </td>
                        )}
                        {selectedColumns.has('XP Count') && (
                          <td>{(card as any).xp_total || 0} XP</td>
                        )}
                        {selectedColumns.has('XP Count (Reading)') && (
                          <td>{(card as any).xp_reading || 0} XP</td>
                        )}
                        {selectedColumns.has('XP Count (Listening)') && (
                          <td>{(card as any).xp_listening || 0} XP</td>
                        )}
                        {selectedColumns.has('XP Count (Speaking)') && (
                          <td>{(card as any).xp_speaking || 0} XP</td>
                        )}
                        {selectedColumns.has('XP Count (Writing)') && (
                          <td>{(card as any).xp_writing || 0} XP</td>
                        )}
                      </tr>
                    );
                  });
                }
              })()}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        <div className="portfolio-table-pagination" style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '16px',
          borderTop: '1px solid var(--neutral)',
          marginTop: '16px'
        }}>
          <div style={{ color: 'var(--text)', fontSize: '14px' }}>
            {savedCardsLoading ? (
              'Loading...'
            ) : (
              filteredCount > 0 ? (
                `Showing ${((currentPage - 1) * CARDS_PER_PAGE) + 1}-${Math.min(currentPage * CARDS_PER_PAGE, filteredCount)} of ${filteredCount.toLocaleString()} cards`
              ) : (
                'No cards found'
              )
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="portfolio-table-pagination-btn"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1 || savedCardsLoading}
              style={{
                padding: '8px 16px',
                background: currentPage === 1 || savedCardsLoading ? 'var(--hover-bg)' : 'var(--primary)',
                color: currentPage === 1 || savedCardsLoading ? 'var(--neutral)' : '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: currentPage === 1 || savedCardsLoading ? 'not-allowed' : 'pointer',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '10px'
              }}
            >
              Previous
            </button>
            <span style={{ color: 'var(--text)', fontSize: '14px', minWidth: '80px', textAlign: 'center' }}>
              Page {currentPage} {filteredCount > 0 && `of ${Math.ceil(filteredCount / CARDS_PER_PAGE)}`}
            </span>
            <button
              className="portfolio-table-pagination-btn"
              onClick={() => setCurrentPage(prev => prev + 1)}
              disabled={currentPage * CARDS_PER_PAGE >= filteredCount || savedCardsLoading}
              style={{
                padding: '8px 16px',
                background: currentPage * CARDS_PER_PAGE >= filteredCount || savedCardsLoading ? 'var(--hover-bg)' : 'var(--primary)',
                color: currentPage * CARDS_PER_PAGE >= filteredCount || savedCardsLoading ? 'var(--neutral)' : '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: currentPage * CARDS_PER_PAGE >= filteredCount || savedCardsLoading ? 'not-allowed' : 'pointer',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '10px'
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>


      {/* Practice Modal */}
      {practiceModalOpen && (
        <div className="practice-modal-overlay" onClick={() => setPracticeModalOpen(false)}>
          <div className="practice-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="practice-modal-header">
              <h2 className="practice-modal-title typography-pressstart-1">PLAY</h2>
              <button 
                className="practice-modal-close"
                onClick={() => setPracticeModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="practice-modal-body">
              <div className="practice-modal-section">
                <div className="practice-modal-label typography-pressstart-1">Skill:</div>
                <div className="practice-modal-radio-group">
                  <label className="practice-modal-radio">
                    <input
                      type="radio"
                      name="skill"
                      value="reading"
                      checked={selectedSkill === 'reading'}
                      onChange={(e) => setSelectedSkill(e.target.value as typeof selectedSkill)}
                    />
                    <span className="typography-pressstart-1">Reading</span>
                  </label>
                  <label className="practice-modal-radio">
                    <input
                      type="radio"
                      name="skill"
                      value="listening"
                      checked={selectedSkill === 'listening'}
                      onChange={(e) => setSelectedSkill(e.target.value as typeof selectedSkill)}
                    />
                    <span className="typography-pressstart-1">Listening</span>
                  </label>
                  <label className="practice-modal-radio">
                    <input
                      type="radio"
                      name="skill"
                      value="speaking"
                      checked={selectedSkill === 'speaking'}
                      onChange={(e) => setSelectedSkill(e.target.value as typeof selectedSkill)}
                    />
                    <span className="typography-pressstart-1">Speaking</span>
                  </label>
                  <label className="practice-modal-radio">
                    <input
                      type="radio"
                      name="skill"
                      value="writing"
                      checked={selectedSkill === 'writing'}
                      onChange={(e) => setSelectedSkill(e.target.value as typeof selectedSkill)}
                    />
                    <span className="typography-pressstart-1">Writing</span>
                  </label>
                </div>
              </div>
              
              <button 
                className="practice-modal-go-btn typography-pressstart-1"
                onClick={handlePracticeGo}
              >
                GO &gt;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
