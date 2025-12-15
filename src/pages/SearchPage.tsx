import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import SearchResultCard from "../components/SearchResultCard";
import FilterPanel from "../components/FilterPanel";
import type { CardDoc, FilmDoc } from "../types";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";
import {
  apiSearch,
  apiListItems,
  apiSearchCounts,
  apiSearchCardsFTS,
} from "../services/cfApi";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import "../styles/pages/search-page.css";

function SearchPage() {
  const { preferences } = useUser();
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
  const [itemsLoading, setItemsLoading] = useState(true);
  const [serverContentCounts, setServerContentCounts] = useState<Record<string, number>>({});
  const pageSize = 50;
  const isTextSearch = useMemo(() => query.trim().length >= 2, [query]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          });
          setCards(items);
          setTotal(items.length);
          setPage(pageNum);
          // If we hit the current limit and haven't reached maxLimit, allow more loads
          setHasMore(items.length === effectiveLimit && effectiveLimit < maxLimit);
        } else {
          // Browsing mode: use paginated /api/search
          const result = await apiSearch({
            query: "",
            page: pageNum,
            size: pageSize,
            mainLanguage: preferences.main_language || null,
            subtitleLanguages: preferences.subtitle_languages || [],
            contentIds: contentFilter.length > 0 ? contentFilter : undefined,
            signal: abortControllerRef.current.signal,
          });

          if (pageNum === 1) {
            setCards(result.items);
          } else {
            setCards((prev) => [...prev, ...result.items]);
          }

          setTotal(result.total);
          setPage(pageNum);
          setHasMore(pageNum * pageSize < result.total);
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
    [preferences.main_language, preferences.subtitle_languages, pageSize, contentFilter]
  );

  // Fetch all content items on mount only (cached by apiListItems)
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) {
          setItemsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch card counts per content from server (bao gồm filter + query)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const counts = await apiSearchCounts({
          mainLanguage: preferences.main_language || null,
          subtitleLanguages: preferences.subtitle_languages || [],
          // Use query + languages only so counts stay stable even when content filter changes
          query: query.trim().length >= 2 ? query : "",
          contentIds: undefined,
        });
        if (!cancelled) {
          setServerContentCounts(counts);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load content counts:", error);
          setServerContentCounts({});
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [preferences.main_language, preferences.subtitle_languages, query]);

  // Debounce: chuyển searchInput -> query (giảm re-render & lag khi gõ)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = searchInput.trim();
    // Nếu input rỗng thì reset query và load lại chế độ browse
    if (!trimmed) {
      setQuery("");
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      setQuery(trimmed);
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput]);

  // Khi query (đã debounce) hoặc filter / language đổi thì gọi API
  useEffect(() => {
    setPage  (1);
    setHasMore(true);
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      fetchCards(trimmed, 1);
    } else {
      fetchCards("", 1);
    }
  }, [query, preferences.main_language, preferences.subtitle_languages, contentFilter, fetchCards]);

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

  // Content counts: 
  // - Khi không search: dùng tổng từ server (apiSearchCounts với main_language + subtitle_languages + contentIds)
  // - Khi search: dùng apiSearchCounts với q + mainLanguage + contentIds để lấy tổng số card match theo content
  const contentCounts = useMemo(() => {
    return serverContentCounts;
  }, [serverContentCounts]);

  // No client-side filtering needed - API handles contentFilter
  const filteredCards = cards;

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

  return (
    <div className="search-page-container">
      {isFilterPanelOpen && (
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
        />
      )}

      <div className="search-layout-wrapper">
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
                placeholder="Search across all films..."
                loading={loading || firstLoading}
              />
            </div>

            <div className="search-stats typography-inter-4">
              {loading ? "Searching..." : `${total} Cards`}
            </div>
          </div>

          <div className="search-results">
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
    </div>
  );
}

export default SearchPage;
