import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import SearchResultCard from "../components/SearchResultCard";
import FilterPanel from "../components/FilterPanel";
import FilterModal from "../components/FilterModal";
import CustomizeModal from "../components/CustomizeModal";
import type { CardDoc } from "../types";
import SearchBar from "../components/SearchBar";
import SubtitleLanguageSelector from "../components/SubtitleLanguageSelector";
import { useUser } from "../context/UserContext";
import {
  apiSearch,
  apiSearchCardsFTS,
  apiGetCardSaveStatusBatch,
  apiListItems,
} from "../services/cfApi";
import { createTimeTrackingRefs, cleanupTimeTracking } from "../utils/TimeTrackingUtils";
import {
  getStoredLevelMin,
  getStoredLevelMax,
  setStoredLevelRange,
} from "../utils/levelRangeStorage";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import filterIcon from "../assets/icons/filter.svg";
import customIcon from "../assets/icons/custom.svg";
import informationIcon from "../assets/icons/information.svg";
import practiceMonsterIcon from "../assets/icons/practice-monster.svg";
import thumbUpIcon from "../assets/icons/thumb-up.svg";
import thumbDownIcon from "../assets/icons/thumb-down.svg";
import headphoneIcon from "../assets/icons/headphone.svg";
import speakIcon from "../assets/icons/speak.svg";
import "../styles/pages/search-page.css";

function SearchPage() {
  const { user, preferences } = useUser();
  // Session storage key prefix
  const SP_PREFIX = 'sp_';

  // Helper to safely read from sessionStorage
  const getSessionValue = <T,>(key: string, defaultValue: T): T => {
    try {
      const v = sessionStorage.getItem(SP_PREFIX + key);
      if (v === null) return defaultValue;
      return JSON.parse(v) as T;
    } catch { return defaultValue; }
  };

  // Helper to safely read string from sessionStorage
  const getSessionString = (key: string, defaultValue: string): string => {
    try {
      return sessionStorage.getItem(SP_PREFIX + key) || defaultValue;
    } catch { return defaultValue; }
  };

  // Helper to safely read number from sessionStorage
  const getSessionNumber = (key: string, defaultValue: number): number => {
    try {
      const v = sessionStorage.getItem(SP_PREFIX + key);
      if (v === null) return defaultValue;
      const n = Number(v);
      return isNaN(n) ? defaultValue : n;
    } catch { return defaultValue; }
  };

  // Helper to safely read boolean from sessionStorage
  const getSessionBool = (key: string, defaultValue: boolean): boolean => {
    try {
      const v = sessionStorage.getItem(SP_PREFIX + key);
      if (v === null) return defaultValue;
      return v === 'true';
    } catch { return defaultValue; }
  };

  // inputValue: giá trị đang gõ trong ô SearchBar (không dùng để query trực tiếp)
  const [searchInput, setSearchInput] = useState(() => getSessionString('input', ''));
  // query: giá trị đã được debounce, dùng để gọi API + highlight
  const [query, setQuery] = useState(() => getSessionString('query', ''));
  const [hasEnteredSearch, setHasEnteredSearch] = useState(() => getSessionBool('entered_search', true));
  const [loading, setLoading] = useState(true);
  // Check if we have cached results - skip firstLoading skeleton if cache is warm
  const [firstLoading, setFirstLoading] = useState(() => {
    // If query is in sessionStorage, we have cached results
    const hasCachedQuery = sessionStorage.getItem(SP_PREFIX + 'query') !== null;
    return !hasCachedQuery;
  });
  const [cards, setCards] = useState<CardDoc[]>(() => getSessionValue<CardDoc[]>('cards', []));
  const [total, setTotal] = useState(() => getSessionNumber('total', 0));
  const [cardSaveStatuses, setCardSaveStatuses] = useState<Record<string, { saved: boolean; srs_state: string; review_count: number }>>(() => getSessionValue<Record<string, { saved: boolean; srs_state: string; review_count: number }>>('cardSaveStatuses', {}));
  const [contentFilter, setContentFilter] = useState<string[]>(() => getSessionValue<string[]>('content_filter', []));
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(() => {
    const v = sessionStorage.getItem(SP_PREFIX + 'filter_panel_open');
    return v === null ? true : v === 'true';
  });
  const [page, setPage] = useState(() => getSessionNumber('page', 1));
  const [hasMore, setHasMore] = useState(() => {
    const v = sessionStorage.getItem(SP_PREFIX + 'has_more');
    return v === null ? true : v === 'true';
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Content metadata from search results only (no separate /items fetch for initial load)
  const [contentMeta, setContentMeta] = useState(() => getSessionValue<Record<string, { id: string; title?: string; type?: string; main_language?: string; level_framework_stats?: import("../types").LevelFrameworkStats | null }>>('content_meta', {}));
  // Global content items list for ContentSelector (cached via apiListItems)
  const [allItems, setAllItems] = useState<any[]>([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<'up' | 'down' | null>(null);
  const [practiceMode, setPracticeMode] = useState<'listening' | 'reading' | 'speaking' | 'writing' | null>(null);
  // Legacy filters (kept for API compatibility, but not used in UI)
  const [minDifficulty] = useState(0);
  const [maxDifficulty] = useState(100);
  const [minLevel] = useState<string | null>(null);
  const [maxLevel] = useState<string | null>(null);

  // New filters
  const [minLength, setMinLength] = useState(() => getSessionNumber('min_length', 1));
  const [maxLength, setMaxLength] = useState(() => getSessionNumber('max_length', 100));
  const [maxDuration, setMaxDuration] = useState(() => getSessionNumber('max_duration', 120));
  const [minReview, setMinReview] = useState(() => getSessionNumber('min_review', 0));
  const [maxReview, setMaxReview] = useState(() => getSessionNumber('max_review', 1000));
  const [levelMin, setLevelMin] = useState<number>(() => getStoredLevelMin());
  const [levelMax, setLevelMax] = useState<number>(() => getStoredLevelMax());
  const [volume, setVolume] = useState(28);
  const [resultLayout, setResultLayout] = useState<'default' | '1-column' | '2-column'>('default');
  const contentTypeFilter: 'all' | 'movie' | 'series' | 'book' = 'all';
  const pageSize = 20;
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Persist state to sessionStorage when it changes
  // These effects ensure state survives navigation away and back to SearchPage
  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'input', searchInput); } catch { /* silent */ }
  }, [searchInput]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'query', query); } catch { /* silent */ }
  }, [query]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'entered_search', String(hasEnteredSearch)); } catch { /* silent */ }
  }, [hasEnteredSearch]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'content_filter', JSON.stringify(contentFilter)); } catch { /* silent */ }
  }, [contentFilter]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'filter_panel_open', String(isFilterPanelOpen)); } catch { /* silent */ }
  }, [isFilterPanelOpen]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'page', String(page)); } catch { /* silent */ }
  }, [page]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'has_more', String(hasMore)); } catch { /* silent */ }
  }, [hasMore]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'content_meta', JSON.stringify(contentMeta)); } catch { /* silent */ }
  }, [contentMeta]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'min_length', String(minLength)); } catch { /* silent */ }
  }, [minLength]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'max_length', String(maxLength)); } catch { /* silent */ }
  }, [maxLength]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'max_duration', String(maxDuration)); } catch { /* silent */ }
  }, [maxDuration]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'min_review', String(minReview)); } catch { /* silent */ }
  }, [minReview]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'max_review', String(maxReview)); } catch { /* silent */ }
  }, [maxReview]);

  // Persist level range
  useEffect(() => {
    setStoredLevelRange(levelMin, levelMax);
  }, [levelMin, levelMax]);

  // Sync level range from sessionStorage when SetLevelModal applies a new range
  useEffect(() => {
    const sync = () => {
      setLevelMin(getStoredLevelMin());
      setLevelMax(getStoredLevelMax());
    };
    // Initial sync
    sync();
    // Listen for custom event from NavBar/SetLevelModal
    window.addEventListener('level-range-updated', sync);
    return () => window.removeEventListener('level-range-updated', sync);
  }, []);

  // Persist cards and total separately (they come from API, not user input)
  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'cards', JSON.stringify(cards)); } catch { /* silent */ }
  }, [cards]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'total', String(total)); } catch { /* silent */ }
  }, [total]);

  useEffect(() => {
    try { sessionStorage.setItem(SP_PREFIX + 'cardSaveStatuses', JSON.stringify(cardSaveStatuses)); } catch { /* silent */ }
  }, [cardSaveStatuses]);

  const fetchCards = useCallback(
    async (searchQuery: string, pageNum: number) => {
      const trimmed = searchQuery.trim();
      const isText = trimmed.length >= 2;
      
      // Performance logging
      const perfStart = performance.now();
      const logLabel = `[SearchPage] fetchCards ${isText ? 'FTS' : 'Browse'} page=${pageNum}`;
      
      // Prevent concurrent requests
      if (isFetchingRef.current && pageNum > 1) {
        console.log(`${logLabel}: Skipped - already fetching`);
        return; // Skip if already fetching (only for pagination)
      }

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      isFetchingRef.current = true;

      if (pageNum === 1) {
        setLoading(true);
        setIsLoadingMore(false);
      } else {
        setIsLoadingMore(true);
      }

      try {
        if (isText) {
          // Use FTS endpoint for text search with increasing limit (pseudo-pagination)
          const maxLimit = 200;
          const effectiveLimit = Math.min(pageNum * pageSize, maxLimit);

          const apiStart = performance.now();
          const { items, content_meta } = await apiSearchCardsFTS({
            q: trimmed,
            limit: effectiveLimit,
            mainLanguage: preferences.main_language || null,
            subtitleLanguages: preferences.subtitle_languages || [],
            contentIds: contentFilter.length ? contentFilter : undefined,
            minDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? minDifficulty : undefined,
            maxDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? maxDifficulty : undefined,
            minLevel: minLevel || undefined,
            maxLevel: maxLevel || undefined,
            minLength: minLength !== 1 ? minLength : undefined,
            maxLength: maxLength !== 100 ? maxLength : undefined,
            maxDuration: maxDuration !== 120 ? maxDuration : undefined,
            minReview: minReview !== 0 ? minReview : undefined,
            maxReview: maxReview !== 1000 ? maxReview : undefined,
            userId: user?.uid || null,
          });
          const apiTime = performance.now() - apiStart;
          console.log(`${logLabel}: API call took ${apiTime.toFixed(2)}ms, returned ${items.length} items`);

          setCards(items);
          if (content_meta && Object.keys(content_meta).length > 0) {
            console.log("[SearchPage] content_meta titles (FTS)", Object.values(content_meta).map(m => ({ id: m.id, title: m.title })));
            setContentMeta(prev => ({ ...prev, ...content_meta }));
          }
          setTotal(items.length);
          setPage(pageNum);
          // If we hit the current limit and haven't reached maxLimit, allow more loads
          setHasMore(items.length === effectiveLimit && effectiveLimit < maxLimit);

          // Batch load save statuses for all cards (only if user is logged in and cards exist)
          // Note: Don't clear cardSaveStatuses here - we want to preserve persisted state and merge new statuses
          // Load in background with delay to prioritize main content loading
          if (user?.uid && items.length > 0) {
            const statusStart = performance.now();
            const cardsToLoad = items.map(card => ({
              card_id: card.id,
              film_id: card.film_id,
              episode_id: card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
            }));

            // Delay save status loading to prioritize main content (load after 500ms)
            setTimeout(() => {
              apiGetCardSaveStatusBatch(user.uid!, cardsToLoad)
                .then(statuses => {
                  const statusTime = performance.now() - statusStart;
                  console.log(`${logLabel}: Save status batch took ${statusTime.toFixed(2)}ms for ${cardsToLoad.length} cards`);
                  setCardSaveStatuses(prev => ({ ...prev, ...statuses }));
                })
                .catch(error => {
                  console.error(`${logLabel}: Failed to load batch save statuses:`, error);
                });
            }, 500);
          }
        } else {
          // FIX: Browsing mode - use /api/search with empty query to get available cards
          // This shows cards even when user hasn't searched yet
          const apiStart = performance.now();
          const result = await apiSearch({
            query: "", // Empty query = browsing mode, shows available cards
            page: pageNum,
            size: pageSize,
            mainLanguage: preferences.main_language || null,
            subtitleLanguages: preferences.subtitle_languages || [],
            contentIds: contentFilter.length > 0 ? contentFilter : undefined,
            includeContentMeta: true,
            minDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? minDifficulty : undefined,
            maxDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? maxDifficulty : undefined,
            minLevel: minLevel || undefined,
            maxLevel: maxLevel || undefined,
            minLength: minLength !== 1 ? minLength : undefined,
            maxLength: maxLength !== 100 ? maxLength : undefined,
            maxDuration: maxDuration !== 120 ? maxDuration : undefined,
            minReview: minReview !== 0 ? minReview : undefined,
            maxReview: maxReview !== 1000 ? maxReview : undefined,
            userId: user?.uid || null,
            signal: abortControllerRef.current.signal,
          });
          const apiTime = performance.now() - apiStart;
          console.log(`${logLabel}: API call (browsing mode) took ${apiTime.toFixed(2)}ms, returned ${result.items.length} items (total: ${result.total})`);

          if (result.content_meta && Object.keys(result.content_meta).length > 0) {
            setContentMeta(prev => ({ ...prev, ...result.content_meta }));
          }
          if (pageNum === 1) {
            setCards(result.items);
            // Note: Don't clear cardSaveStatuses - preserve persisted state and merge new statuses
          } else {
            setCards((prev) => [...prev, ...result.items]);
          }

          // Handle case where total is -1 (not available, skipped for speed)
          if (result.total === -1) {
            // Estimate: if we got full page, assume there's more
            setTotal(result.items.length);
            setHasMore(result.items.length === pageSize);
          } else {
            setTotal(result.total);
            setHasMore(pageNum * pageSize < result.total);
          }
          setPage(pageNum);

          // Batch load save statuses for all cards (only if user is logged in and cards exist)
          // Load in background with delay to prioritize main content loading
          if (user?.uid && result.items.length > 0) {
            const statusStart = performance.now();
            const cardsToLoad = result.items.map(card => ({
              card_id: card.id,
              film_id: card.film_id,
              episode_id: card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
            }));

            // Delay save status loading to prioritize main content (load after 500ms)
            setTimeout(() => {
              apiGetCardSaveStatusBatch(user.uid!, cardsToLoad)
                .then(statuses => {
                  const statusTime = performance.now() - statusStart;
                  console.log(`${logLabel}: Save status batch took ${statusTime.toFixed(2)}ms for ${cardsToLoad.length} cards`);
                  setCardSaveStatuses(prev => ({ ...prev, ...statuses }));
                })
                .catch(error => {
                  console.error(`${logLabel}: Failed to load batch save statuses:`, error);
                });
            }, 500);
          }
        }
        
        const totalTime = performance.now() - perfStart;
        console.log(`${logLabel}: Total time ${totalTime.toFixed(2)}ms`);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          // Request was cancelled - still need to reset loading
          console.log(`${logLabel}: Cancelled`);
          if (pageNum === 1) {
            setLoading(false);
            setFirstLoading(false);
          } else {
            setIsLoadingMore(false);
          }
          isFetchingRef.current = false;
          return;
        }
        const totalTime = performance.now() - perfStart;
        console.error(`${logLabel}: Error after ${totalTime.toFixed(2)}ms:`, error);
        // Don't clear cards on error for pagination - keep what we have
        if (pageNum === 1) {
          setCards([]);
          setTotal(0);
        }
      } finally {
        isFetchingRef.current = false;
        if (pageNum === 1) {
          setLoading(false);
          setFirstLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    [preferences.main_language, preferences.subtitle_languages, pageSize, contentFilter, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, user?.uid]
  );

  // Content metadata comes from search response (content_meta) - no separate /items fetch for initial load

  // Serialize subtitle_languages array for stable dependency comparison
  const subtitleLangsKey = useMemo(() => 
    JSON.stringify((preferences.subtitle_languages || []).sort()), 
    [preferences.subtitle_languages]
  );
  
  // Serialize contentFilter array for stable dependency comparison
  const contentFilterKey = useMemo(() => 
    JSON.stringify([...contentFilter].sort()), 
    [contentFilter]
  );

  // DISABLED: Server-side counts are too slow (counts entire DB)
  // Instead, we'll use client-side counts from allResults which is much faster
  // ContentSelector will fallback to counting from allResults if contentCounts is not provided

  // Handle search trigger from SearchBar (click icon or Enter key, or suggestion selected)
  // This should only trigger when user explicitly searches, not while typing
  const handleSearch = useCallback((searchValue: string) => {
    const trimmed = searchValue.trim();
    setHasEnteredSearch(true);
    setQuery(trimmed);
    setFeedbackChoice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Track if filter modal is open to prevent auto-fetching
  const [isFilterModalOpenState, setIsFilterModalOpenState] = useState(false);

  // Khi query (đã debounce) hoặc filter / language đổi thì gọi API
  // BUT: Skip if filter modal is open (wait for Apply button)
  useEffect(() => {
    // Keep search layout visible but don't load result list until user enters search flow
    if (!hasEnteredSearch) {
      return;
    }

    // Don't fetch if filter modal is open - wait for Apply button
    if (isFilterModalOpenState) {
      console.log('[SearchPage] Skipping fetch - filter modal is open');
      return;
    }

    const trimmed = query.trim();

    if (!firstLoading) {
      setLoading(true);
    }

    setPage(1);
    setHasMore(true);
    setShouldShuffle(false);
    shuffleSeedRef.current = Date.now();

    fetchCards(trimmed, 1);
  }, [hasEnteredSearch, query, preferences.main_language, subtitleLangsKey, contentFilterKey, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, user?.uid, fetchCards, firstLoading, isFilterModalOpenState]);

  // Detect scroll position for back-to-top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Load full content items list once for ContentSelector (lightweight, cached)
  useEffect(() => {
    let cancelled = false;
    apiListItems()
      .then((items) => {
        if (!cancelled) setAllItems(items || []);
      })
      .catch((e) => {
        console.error("[SearchPage] failed to load items for ContentSelector", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build maps for FilterPanel / ContentSelector
  // Prefer full items list when available, fallback to content_meta
  const filmTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allItems.length > 0) {
      allItems.forEach((it: any) => {
        if (it?.id) map[it.id] = it.title || it.id;
      });
    } else {
      Object.entries(contentMeta).forEach(([, meta]) => {
        if (meta?.id) map[meta.id] = meta.title || meta.id;
      });
    }
    return map;
  }, [allItems, contentMeta]);

  const filmTypeMap = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    if (allItems.length > 0) {
      allItems.forEach((it: any) => {
        if (it?.id) map[it.id] = it.type;
      });
    } else {
      Object.entries(contentMeta).forEach(([, meta]) => {
        if (meta?.id) map[meta.id] = meta.type;
      });
    }
    return map;
  }, [allItems, contentMeta]);

  const filmLangMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allItems.length > 0) {
      allItems.forEach((it: any) => {
        if (it?.id && it.main_language) map[it.id] = it.main_language;
      });
    } else {
      Object.entries(contentMeta).forEach(([, meta]) => {
        if (meta?.id && meta.main_language) map[meta.id] = meta.main_language;
      });
    }
    return map;
  }, [allItems, contentMeta]);

  const filmStatsMap = useMemo(() => {
    const map: Record<string, any> = {};
    if (allItems.length > 0) {
      allItems.forEach((it: any) => {
        if (it?.id) map[it.id] = it.level_framework_stats ?? null;
      });
    } else {
      Object.entries(contentMeta).forEach(([, meta]) => {
        if (meta?.id) map[meta.id] = meta.level_framework_stats ?? null;
      });
    }
    return map;
  }, [allItems, contentMeta]);

  const allContentIds = useMemo(() => {
    if (allItems.length > 0) {
      return allItems.map((it: any) => it.id).filter(Boolean);
    }
    return Object.values(contentMeta)
      .map((m) => m.id)
      .filter(Boolean);
  }, [allItems, contentMeta]);

  // Content counts: Use client-side counting from allResults (much faster than server-side)
  // This counts only the cards that are already loaded, not the entire database
  const contentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    
    // Count cards from allResults (already filtered by query and other filters)
    for (const card of cards) {
      const contentId = card.film_id;
      if (contentId) {
        counts[contentId] = (counts[contentId] || 0) + 1;
      }
    }
    
    // Ensure all content items from allContentIds have an entry (even if 0)
    if (allContentIds && allContentIds.length > 0) {
      for (const id of allContentIds) {
        if (!(id in counts)) {
          counts[id] = 0; // Initialize with 0 if no cards in current results
        }
      }
    }
    
    return counts;
  }, [cards, allContentIds]);

  // Filter and shuffle cards for random display order
  // Skip shuffle for initial load to show cards faster - only shuffle on user interaction
  const [shouldShuffle, setShouldShuffle] = useState(false);
  const shuffleSeedRef = useRef<number>(Date.now());
  const filteredCards = useMemo(() => {
    if (cards.length === 0) return [];

    // Filter by content type when not "all"
    let list = cards;
    if (contentTypeFilter !== 'all') {
      list = cards.filter((c) => c.film_id != null && filmTypeMap[c.film_id] === contentTypeFilter);
    }

    // Filter by CEFR level from URL param ?level=A1 (legacy)
    const params = new URLSearchParams(window.location.search);
    const levelFilter = params.get("level");
    if (levelFilter) {
      const normalizedLevel = levelFilter.toUpperCase();
      list = list.filter((card) =>
        Array.isArray(card.levels) &&
        card.levels.some((lvl) => (lvl.level || "").toUpperCase() === normalizedLevel)
      );
    }

    // NEW: Filter by selected frequency range from SetLevelModal (min/max)
    if (levelMin >= 0 && levelMax >= 0 && levelMax > levelMin) {
      const normalize = (s: string) => String(s || '').trim().toLowerCase();
      list = list.filter((card) => {
        if (!Array.isArray(card.level_frequency_ranks) || card.level_frequency_ranks.length === 0) {
          return false;
        }

        // Follow the same binding logic as level-badge-number in SearchResultCard
        const primaryFramework = card.levels?.[0]?.framework || "CEFR";
        const frameworkKey = normalize(primaryFramework);
        const freqEntry = card.level_frequency_ranks.find(
          (f) => normalize(f.framework) === frameworkKey
        ) || card.level_frequency_ranks[0];

        const freqRank = typeof freqEntry?.frequency_rank === 'number'
          ? Math.round(freqEntry.frequency_rank)
          : null;

        if (freqRank == null) return false;
        return freqRank >= levelMin && freqRank <= levelMax;
      });
    }

    // Skip shuffle on initial load for faster display
    // Only shuffle if explicitly requested (e.g., user clicks shuffle button)
    if (!shouldShuffle) {
      return list;
    }

    // Use seeded random for consistent shuffle per card set
    const shuffled = [...list];
    let seed = shuffleSeedRef.current;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [cards, contentTypeFilter, shouldShuffle, filmTypeMap, levelMin, levelMax]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || isLoadingMore || isFetchingRef.current) return;
    fetchCards(query, page + 1);
  }, [hasMore, loading, isLoadingMore, page, query, fetchCards]);

  // --- Time tracking (logic extracted to src/utils/TimeTrackingUtils.ts) ---
  const timeTrackingRefs = createTimeTrackingRefs();

  // Cleanup on unmount — flush remaining accumulated time
  useEffect(() => {
    return () => {
      cleanupTimeTracking(timeTrackingRefs, user?.uid);
    };
  }, [user?.uid]);

  // Memoized filter change handlers to prevent unnecessary re-renders
  const handleLengthChange = useCallback((min: number, max: number) => {
    console.log(`[SearchPage] Length filter changed: ${min}-${max}`);
    setMinLength(min);
    setMaxLength(max);
  }, []);

  const handleDurationChange = useCallback((max: number) => {
    console.log(`[SearchPage] Duration filter changed: ${max}`);
    setMaxDuration(max);
  }, []);

  const handleReviewChange = useCallback((min: number, max: number) => {
    console.log(`[SearchPage] Review filter changed: ${min}-${max}`);
    setMinReview(min);
    setMaxReview(max);
  }, []);

  return (
    <div className="search-page-container">
      {/* Overlay for mobile - click outside to close */}
      {isFilterPanelOpen && (
        <div 
          className="filter-panel-overlay"
          onClick={() => setIsFilterPanelOpen(false)}
          aria-hidden="true"
        />
      )}
      
      <FilterPanel
        filmTitleMap={filmTitleMap}
        filmTypeMap={filmTypeMap}
        filmLangMap={filmLangMap}
        filmStatsMap={filmStatsMap}
        allResults={cards}
        contentCounts={contentCounts}
        totalCount={total}
        allContentIds={allContentIds}
        filmFilter={contentFilter}
        onSelectFilm={setContentFilter}
        mainLanguage={preferences.main_language || "en"}
        activeContentType={contentTypeFilter}
        isOpen={isFilterPanelOpen}
        onClose={() => setIsFilterPanelOpen(false)}
      />

      <div className={`search-layout-wrapper ${!isFilterPanelOpen ? 'filter-panel-closed' : ''}`}>
        <main className="search-main">
          <div className="search-controls">
            <div className="search-bar-container">
              <button
                className={`filter-panel-toggle-btn ${isFilterPanelOpen ? "active" : ""}`}
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
              </button>
              <SearchBar
                value={searchInput}
                onChange={(v) => setSearchInput(v)}
                onSearch={handleSearch}
                placeholder=""
                loading={loading || firstLoading}
                enableAutocomplete={true}
                debounceMs={300}
                language={preferences.main_language || "en"}
              />
              <div className="practice-wrapper">
                <button
                  type="button"
                  className={`practice-btn ${isPracticeOpen ? "open" : ""}`}
                  onClick={() => setIsPracticeOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={isPracticeOpen}
                >
                  <img
                    src={practiceMonsterIcon}
                    alt="Practice"
                    className="practice-icon"
                  />
                  <span className="practice-label">Practice</span>
                  <span className="practice-divider" aria-hidden="true" />
                  <img
                    src={rightAngleIcon}
                    alt=""
                    className="practice-chevron-icon"
                    aria-hidden="true"
                  />
                </button>
                {isPracticeOpen && (
                  <div className="practice-dropdown" role="menu">
                    <button
                      type="button"
                      className={`practice-dropdown-item ${practiceMode === 'listening' ? 'selected' : ''}`}
                      onClick={() => { setPracticeMode('listening'); setIsPracticeOpen(false); }}
                      aria-pressed={practiceMode === 'listening'}
                      role="menuitem"
                    >
                      <img src={headphoneIcon} alt="" aria-hidden="true" className="practice-item-icon" />
                      <span>Listening</span>
                    </button>
                    <button
                      type="button"
                      className={`practice-dropdown-item ${practiceMode === 'speaking' ? 'selected' : ''}`}
                      onClick={() => { setPracticeMode('speaking'); setIsPracticeOpen(false); }}
                      aria-pressed={practiceMode === 'speaking'}
                      role="menuitem"
                    >
                      <img src={speakIcon} alt="" aria-hidden="true" className="practice-item-icon" />
                      <span>Speaking</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                className="filter-panel-toggle-btn"
                type="button"
                onClick={() => {
                  // TODO: wire up information modal or tooltip
                }}
                aria-label="Open information"
              >
                <img src={informationIcon} alt="Information" />
              </button>
              <button
                className="filter-panel-toggle-btn"
                onClick={() => {
                  setIsFilterModalOpen(true);
                  setIsFilterModalOpenState(true);
                }}
                aria-label="Open filters"
              >
                <img
                  src={filterIcon}
                  alt="Filter"
                />
              </button>
              <button
                className="filter-panel-toggle-btn"
                onClick={() => setIsCustomizeModalOpen(true)}
                aria-label="Customize"
              >
                <img
                  src={customIcon}
                  alt="Customize"
                />
              </button>
            </div>

            <div className="search-stats typography-inter-4">
              <SubtitleLanguageSelector className="search-subtitle-selector" />
              <span className="search-stats-text">
                {hasEnteredSearch ? (loading ? "Searching..." : `${total} Cards`) : "Ready to explore"}
              </span>
            </div>
          </div>

          <div className={`search-results layout-${resultLayout === 'default' ? 'default' : resultLayout === '1-column' ? '1-column' : '2-column'} ${!isFilterPanelOpen ? 'filter-panel-closed' : ''}`}>
            {loading && cards.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
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
              : (
                <>
                  {filteredCards.map((card) => {
                    const stableKey = `${card.film_id || "item"}-${
                      card.episode_id || card.episode || "e"
                    }-${card.id}`;
                    const saveStatus =
                      cardSaveStatuses[card.id] || {
                        saved: false,
                        srs_state: "none",
                        review_count: 0,
                      };
                    const titleFromMeta =
                      (card.film_id && filmTitleMap[card.film_id]) || undefined;
                    return (
                      <SearchResultCard
                        key={stableKey}
                        card={card}
                        highlightQuery={query}
                        primaryLang={preferences.main_language}
                        volume={volume}
                        subtitleLanguages={preferences.subtitle_languages}
                        filmTitle={titleFromMeta}
                        initialSaveStatus={saveStatus}
                        onSaveStatusChange={(cardId, status) => {
                          setCardSaveStatuses(prev => ({ ...prev, [cardId]: status }));
                          try {
                            const keys = Object.keys(sessionStorage);
                            for (const k of keys) {
                              if (k.startsWith('gg_save:')) sessionStorage.removeItem(k);
                            }
                          } catch { /* silent */ }
                        }}
                        practiceMode={practiceMode}
                      />
                    );
                  })}
                  {isLoadingMore && (
                    <div className="search-card-skeleton" style={{
                      height: "160px",
                      background:
                        `linear-gradient(90deg, var(--hover-bg) 25%, var(--hover-bg-subtle) 50%, var(--hover-bg) 75%)`,
                      backgroundSize: "200% 100%",
                      animation: "skeleton-loading 1.5s ease-in-out infinite",
                      borderRadius: "8px",
                      marginBottom: "1rem",
                    }} />
                  )}

                  <div className="search-load-more-footer" aria-label="Load more and feedback">
                    {hasMore && (
                      <button
                        type="button"
                        className="search-load-more-btn"
                        onClick={handleLoadMore}
                        disabled={loading || isLoadingMore}
                      >
                        LOAD MORE
                      </button>
                    )}
                    <div className="search-found-text">
                      Found what you were looking for? <span aria-hidden="true">👀</span>
                    </div>
                    <div className="search-feedback-row">
                      <button
                        type="button"
                        className={`search-feedback-icon-btn ${feedbackChoice === 'up' ? 'selected' : ''}`}
                        onClick={() => setFeedbackChoice((prev) => (prev === 'up' ? null : 'up'))}
                        aria-pressed={feedbackChoice === 'up'}
                        aria-label="Thumbs up"
                      >
                        <img src={thumbUpIcon} alt="" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`search-feedback-icon-btn ${feedbackChoice === 'down' ? 'selected' : ''}`}
                        onClick={() => setFeedbackChoice((prev) => (prev === 'down' ? null : 'down'))}
                        aria-pressed={feedbackChoice === 'down'}
                        aria-label="Thumbs down"
                      >
                        <img src={thumbDownIcon} alt="" aria-hidden="true" />
                      </button>
                      <span className="search-feedback-text">Feedback</span>
                    </div>
                  </div>
                </>
              )}
          </div>
        </main>
      </div>

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => {
          setIsFilterModalOpen(false);
          setIsFilterModalOpenState(false);
        }}
        minLength={minLength}
        maxLength={maxLength}
        onLengthChange={handleLengthChange}
        maxDuration={maxDuration}
        onDurationChange={handleDurationChange}
        minReview={minReview}
        maxReview={maxReview}
        onReviewChange={handleReviewChange}
      />

      <CustomizeModal
        isOpen={isCustomizeModalOpen}
        onClose={() => setIsCustomizeModalOpen(false)}
        volume={volume}
        onVolumeChange={setVolume}
        resultLayout={resultLayout}
        onLayoutChange={setResultLayout}
      />

      {showBackToTop && (
        <button
          className="back-to-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
        </button>
      )}
    </div>
  );
}

export default SearchPage;
