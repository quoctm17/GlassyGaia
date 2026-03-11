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
import { apiTrackTime } from "../services/userTracking";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import filterIcon from "../assets/icons/filter.svg";
import customIcon from "../assets/icons/custom.svg";
import informationIcon from "../assets/icons/information.svg";
import practiceMonsterIcon from "../assets/icons/practice-monster.svg";
import thumbUpIcon from "../assets/icons/thumb-up.svg";
import thumbDownIcon from "../assets/icons/thumb-down.svg";
import headphoneIcon from "../assets/icons/headphone.svg";
import eyeIcon from "../assets/icons/eye.svg";
import speakIcon from "../assets/icons/speak.svg";
import writingIcon from "../assets/icons/writing.svg";
import { CONTENT_TYPE_LABELS, type ContentType } from "../types/content";
import "../styles/pages/search-page.css";

function SearchPage() {
  const { user, preferences } = useUser();
  // inputValue: giá trị đang gõ trong ô SearchBar (không dùng để query trực tiếp)
  const [searchInput, setSearchInput] = useState("");
  // query: giá trị đã được debounce, dùng để gọi API + highlight
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [firstLoading, setFirstLoading] = useState(true);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [cardSaveStatuses, setCardSaveStatuses] = useState<Record<string, { saved: boolean; srs_state: string; review_count: number }>>({});
  const [contentFilter, setContentFilter] = useState<string[]>([]);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Content metadata from search results only (no separate /items fetch for initial load)
  const [contentMeta, setContentMeta] = useState<Record<string, { id: string; title?: string; type?: string; main_language?: string; level_framework_stats?: import("../types").LevelFrameworkStats | null }>>({});
  // Global content items list for ContentSelector (cached via apiListItems)
  const [allItems, setAllItems] = useState<any[]>([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<'up' | 'down' | null>(null);
  const [practiceMode, setPracticeMode] = useState<'listening' | 'reading' | 'speaking' | 'writing' | null>(null);
  // Legacy filters (kept for API compatibility, but not used in UI)
  const [minDifficulty] = useState(0);
  const [maxDifficulty] = useState(100);
  const [minLevel] = useState<string | null>(null);
  const [maxLevel] = useState<string | null>(null);
  
  // New filters
  const [minLength, setMinLength] = useState(1);
  const [maxLength, setMaxLength] = useState(100);
  const [maxDuration, setMaxDuration] = useState(120);
  const [minReview, setMinReview] = useState(0);
  const [maxReview, setMaxReview] = useState(1000);
  const [volume, setVolume] = useState(28);
  const [resultLayout, setResultLayout] = useState<'default' | '1-column' | '2-column'>('default');
  const [contentTypeFilter, setContentTypeFilter] = useState<'all' | 'movie' | 'series' | 'book'>('all');
  const pageSize = 20;
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

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

          // Clear save statuses when starting new search
          if (pageNum === 1) {
            setCardSaveStatuses({});
          }

          // Batch load save statuses for all cards (only if user is logged in and cards exist)
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
            console.log("[SearchPage] content_meta titles (browse)", Object.values(result.content_meta).map((m: any) => ({ id: m.id, title: m.title })));
            setContentMeta(prev => ({ ...prev, ...result.content_meta }));
          }
          if (pageNum === 1) {
            setCards(result.items);
            // Clear save statuses when starting new search
            setCardSaveStatuses({});
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
    setQuery(trimmed);
  }, []);

  // Track if filter modal is open to prevent auto-fetching
  const [isFilterModalOpenState, setIsFilterModalOpenState] = useState(false);

  // Khi query (đã debounce) hoặc filter / language đổi thì gọi API
  // BUT: Skip if filter modal is open (wait for Apply button)
  useEffect(() => {
    // Don't fetch if filter modal is open - wait for Apply button
    if (isFilterModalOpenState) {
      console.log('[SearchPage] Skipping fetch - filter modal is open');
      return;
    }

    // FIX: Always fetch cards (browsing mode) even when query is empty
    // This ensures new users see cards immediately on first load
    const trimmed = query.trim();

    // Track when filter change started
    if (!firstLoading) {
      setLoading(true);
    }

    // Immediate fetch for query/language changes, debounced for filter changes
    setPage(1);
    setHasMore(true);
    // Reset shuffle on new search/filter
    setShouldShuffle(false);
    shuffleSeedRef.current = Date.now();

    // FIX: Always call fetchCards - empty query means browsing mode
    // The API will return available cards when query is empty
    fetchCards(trimmed, 1);
  }, [query, preferences.main_language, subtitleLangsKey, contentFilterKey, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, user?.uid, fetchCards, firstLoading, isFilterModalOpenState]);

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

    // Filter by CEFR level from URL param ?level=A1
    const params = new URLSearchParams(window.location.search);
    const levelFilter = params.get("level");
    if (levelFilter) {
      const normalizedLevel = levelFilter.toUpperCase();
      list = list.filter((card) =>
        Array.isArray(card.levels) &&
        card.levels.some((lvl) => (lvl.level || "").toUpperCase() === normalizedLevel)
      );
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
  }, [cards, contentTypeFilter, shouldShuffle, filmTypeMap]);

  const availableTypesFromSelection = useMemo(() => {
    const set = new Set<'movie' | 'series' | 'book'>();
    for (const fid of contentFilter) {
      const t = (filmTypeMap[fid] || '').toLowerCase();
      if (t === 'movie' || t === 'series' || t === 'book') set.add(t);
    }
    return set;
  }, [contentFilter, filmTypeMap]);

  const handleContentTypeChange = useCallback((nextType: 'all' | 'movie' | 'series' | 'book') => {
    setContentTypeFilter(nextType);
    if (nextType === 'all') return;
    // Auto-unselect any selected content not matching the chosen type
    setContentFilter(prev => prev.filter(fid => (filmTypeMap[fid] || '').toLowerCase() === nextType));
  }, [filmTypeMap]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || isLoadingMore || isFetchingRef.current) return;
    fetchCards(query, page + 1);
  }, [hasMore, loading, isLoadingMore, page, query, fetchCards]);

  // Track reading time (debounced to avoid too many API calls)
  const readingTimeAccumulatorRef = useRef<number>(0);
  const readingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleTrackReading = useCallback((seconds: number) => {
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
        } catch (error) {
          console.error('Failed to track reading time:', error);
        }
      }
    }, 8000);
  }, [user?.uid]);

  // Track listening time (debounced to avoid too many API calls)
  const listeningTimeAccumulatorRef = useRef<number>(0);
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleTrackListening = useCallback((seconds: number) => {
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
        } catch (error) {
          console.error('Failed to track listening time:', error);
        }
      }
    }, 5000);
  }, [user?.uid]);

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
                      className={`practice-dropdown-item ${practiceMode === 'reading' ? 'selected' : ''}`}
                      onClick={() => { setPracticeMode('reading'); setIsPracticeOpen(false); }}
                      aria-pressed={practiceMode === 'reading'}
                      role="menuitem"
                    >
                      <img src={eyeIcon} alt="" aria-hidden="true" className="practice-item-icon" />
                      <span>Reading</span>
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
                    <button
                      type="button"
                      className={`practice-dropdown-item ${practiceMode === 'writing' ? 'selected' : ''}`}
                      onClick={() => { setPracticeMode('writing'); setIsPracticeOpen(false); }}
                      aria-pressed={practiceMode === 'writing'}
                      role="menuitem"
                    >
                      <img src={writingIcon} alt="" aria-hidden="true" className="practice-item-icon" />
                      <span>Writing</span>
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
                {loading ? "Searching..." : `${total} Cards`}
              </span>
            </div>
            <div className="content-type-filter" role="group" aria-label="Content type">
              {(['all', 'movie', 'series', 'book'] as const)
                .filter((type) => type === 'all' || availableTypesFromSelection.size === 0 || availableTypesFromSelection.has(type))
                .map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`content-type-option typography-noto-content-type ${contentTypeFilter === type ? 'active' : ''}`}
                    onClick={() => handleContentTypeChange(type)}
                    aria-pressed={contentTypeFilter === type}
                  >
                    {type === 'all' ? 'All' : CONTENT_TYPE_LABELS[type as ContentType]}
                  </button>
                ))}
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
                        onTrackReading={handleTrackReading}
                        onTrackListening={handleTrackListening}
                        initialSaveStatus={saveStatus}
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
    </div>
  );
}

export default SearchPage;
