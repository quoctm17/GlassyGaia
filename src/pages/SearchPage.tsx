import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import SearchResultCard from "../components/SearchResultCard";
import FilterPanel from "../components/FilterPanel";
import FilterModal from "../components/FilterModal";
import CustomizeModal from "../components/CustomizeModal";
import type { CardDoc, FilmDoc } from "../types";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";
import {
  apiSearch,
  apiListItems,
  apiSearchCardsFTS,
} from "../services/cfApi";
import { apiTrackTime } from "../services/userTracking";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import filterIcon from "../assets/icons/filter.svg";
import customIcon from "../assets/icons/custom.svg";
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
  const [contentFilter, setContentFilter] = useState<string[]>([]);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allItems, setAllItems] = useState<FilmDoc[]>([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [minDifficulty, setMinDifficulty] = useState(0);
  const [maxDifficulty, setMaxDifficulty] = useState(100);
  const [minLevel, setMinLevel] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState<string | null>(null);
  const [volume, setVolume] = useState(28);
  const [resultLayout, setResultLayout] = useState<'default' | '1-column' | '2-column'>('default');
  const pageSize = 50;
  const isTextSearch = useMemo(() => query.trim().length >= 2, [query]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCards = useCallback(
    async (searchQuery: string, pageNum: number) => {
      const trimmed = searchQuery.trim();
      const isText = trimmed.length >= 2;
      // Prevent concurrent requests
      if (isFetchingRef.current && pageNum > 1) {
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
          const items = await apiSearchCardsFTS({
            q: trimmed,
            limit: effectiveLimit,
            mainLanguage: preferences.main_language || null,
            subtitleLanguages: preferences.subtitle_languages || [],
            contentIds: contentFilter.length ? contentFilter : undefined,
            minDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? minDifficulty : undefined,
            maxDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? maxDifficulty : undefined,
            minLevel: minLevel || undefined,
            maxLevel: maxLevel || undefined,
          });
          setCards(items);
          setTotal(items.length);
          setPage(pageNum);
          // If we hit the current limit and haven't reached maxLimit, allow more loads
          setHasMore(items.length === effectiveLimit && effectiveLimit < maxLimit);
        } else {
          // Browsing mode: use paginated /api/search (supports text search too)
          const result = await apiSearch({
            query: trimmed, // Pass query for text search support
            page: pageNum,
            size: pageSize,
            mainLanguage: preferences.main_language || null,
            subtitleLanguages: preferences.subtitle_languages || [],
            contentIds: contentFilter.length > 0 ? contentFilter : undefined,
            minDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? minDifficulty : undefined,
            maxDifficulty: minDifficulty !== 0 || maxDifficulty !== 100 ? maxDifficulty : undefined,
            minLevel: minLevel || undefined,
            maxLevel: maxLevel || undefined,
            signal: abortControllerRef.current.signal,
          });

          if (pageNum === 1) {
            setCards(result.items);
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
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          // Request was cancelled - still need to reset loading
          if (pageNum === 1) {
            setLoading(false);
            setFirstLoading(false);
          } else {
            setIsLoadingMore(false);
          }
          isFetchingRef.current = false;
          return;
        }
        console.error("Search error:", error);
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
    [preferences.main_language, preferences.subtitle_languages, pageSize, contentFilter, minDifficulty, maxDifficulty, minLevel, maxLevel]
  );

  // Fetch all content items on mount only (cached by apiListItems)
  // Run in parallel with initial card fetch for faster loading
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

  // Handle search trigger from SearchBar (click icon or Enter key)
  const handleSearch = useCallback((searchValue: string) => {
    const trimmed = searchValue.trim();
      setQuery(trimmed);
  }, []);

  // Debounce filter changes for better performance (except for first load)
  const filterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Khi query (đã debounce) hoặc filter / language đổi thì gọi API
  useEffect(() => {
    // Cancel previous filter timeout
    if (filterTimeoutRef.current) {
      clearTimeout(filterTimeoutRef.current);
    }
    
    // Debounce filter changes (100ms) for smoother UX - faster than search
    filterTimeoutRef.current = setTimeout(() => {
      setPage(1);
    setHasMore(true);
      // Reset shuffle on new search/filter
      setShouldShuffle(false);
      shuffleSeedRef.current = Date.now();
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      fetchCards(trimmed, 1);
    } else {
      fetchCards("", 1);
    }
    }, 100); // Short debounce for filter changes - prioritize responsiveness
    
    return () => {
      if (filterTimeoutRef.current) {
        clearTimeout(filterTimeoutRef.current);
      }
    };
  }, [query, preferences.main_language, subtitleLangsKey, contentFilterKey, minDifficulty, maxDifficulty, minLevel, maxLevel, fetchCards]);

  // Filter items by mainLanguage
  const filteredItems = useMemo(() => {
    const mainLang = preferences.main_language || "en";
    return allItems.filter((item) => item.main_language === mainLang);
  }, [allItems, preferences.main_language]);

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
    const map: Record<string, any> = {};
    filteredItems.forEach((item) => {
      if (item.id) {
        map[item.id] = item.level_framework_stats || null;
      }
    });
    return map;
  }, [filteredItems]);

  const allContentIds = useMemo(() => {
    return filteredItems.map((item) => item.id).filter((id): id is string => !!id);
  }, [filteredItems]);

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
    
    // Skip shuffle on initial load for faster display
    // Only shuffle if explicitly requested (e.g., user clicks shuffle button)
    if (!shouldShuffle) {
      return cards; // Return cards in original order for faster display
    }
    
    // Cards are already filtered by API (is_available and subtitle checks)
    // Use seeded random for consistent shuffle per card set
    const shuffled = [...cards];
    // Use seeded random for consistent shuffle
    let seed = shuffleSeedRef.current;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    // Fisher-Yates shuffle with seeded random
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [cards, shouldShuffle]);

  // Infinite scroll: load next page when near bottom (with debounce)
  useEffect(() => {
    const handleScroll = () => {
      // Clear previous timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Debounce scroll handler to prevent too many calls
      scrollTimeoutRef.current = setTimeout(() => {
        if (!hasMore || loading || isLoadingMore || isFetchingRef.current) return;
        const threshold = 400; // px from bottom
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - threshold) {
          fetchCards(query, page + 1);
        }
      }, 200); // 200ms debounce
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [hasMore, loading, isLoadingMore, page, query, fetchCards, isTextSearch]);

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
        isOpen={isFilterPanelOpen}
        onClose={() => setIsFilterPanelOpen(false)}
      />

      <div className={`search-layout-wrapper ${!isFilterPanelOpen ? 'filter-panel-closed' : ''}`}>
        <main className="search-main">
          <div className="search-controls">
            <div className="search-bar-container">
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
              </button>
              <SearchBar
                value={searchInput}
                onChange={(v) => setSearchInput(v)}
                onSearch={handleSearch}
                placeholder=""
                loading={loading || firstLoading}
              />
              <button
                className="filter-panel-toggle-btn"
                onClick={() => setIsFilterModalOpen(true)}
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
              {loading ? "Searching..." : `${total} Cards`}
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
                    return (
                      <SearchResultCard
                      key={stableKey}
                      card={card}
                      highlightQuery={query}
                      primaryLang={preferences.main_language}
                      volume={volume}
                      subtitleLanguages={preferences.subtitle_languages}
                      onTrackReading={handleTrackReading}
                      onTrackListening={handleTrackListening}
                    />
                  )})}
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
                </>
              )}
          </div>
        </main>
      </div>

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        minDifficulty={minDifficulty}
        maxDifficulty={maxDifficulty}
        onDifficultyChange={(min, max) => {
          setMinDifficulty(min);
          setMaxDifficulty(max);
        }}
        minLevel={minLevel}
        maxLevel={maxLevel}
        onLevelChange={(min, max) => {
          setMinLevel(min);
          setMaxLevel(max);
        }}
        mainLanguage={preferences.main_language || "en"}
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
