import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SearchResultCard from "../components/SearchResultCard";
import FilterPanel from "../components/FilterPanel";
import FilterModal from "../components/FilterModal";
import CustomizeModal from "../components/CustomizeModal";
import SubtitleLanguageSelector from "../components/SubtitleLanguageSelector";
import type { CardDoc, FilmDoc, LevelFrameworkStats } from "../types";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";
import {
  apiSearch,
  apiSearchCardsFTS,
  apiGetCardSaveStatusBatch,
  apiListItems,
} from "../services/cfApi";
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
import starIcon from "../assets/icons/star.svg";
import searchIcon from "../assets/icons/search.svg";
import mediaIcon from "../assets/icons/media.svg";
import saveHeartIcon from "../assets/icons/save-heart.svg";
import watchlistIcon from "../assets/icons/watchlist.svg";
import { CONTENT_TYPE_LABELS, type ContentType } from "../types/content";
import "../styles/pages/landing-page.css";

function LandingPage() {
  const { user, preferences } = useUser();
  const navigate = useNavigate();
  const SP_PREFIX = "lp_";

  const getSessionValue = <T,>(key: string, defaultValue: T): T => {
    try {
      const v = sessionStorage.getItem(SP_PREFIX + key);
      if (v === null) return defaultValue;
      return JSON.parse(v) as T;
    } catch { return defaultValue; }
  };

  const getSessionString = (key: string, defaultValue: string): string => {
    try {
      return sessionStorage.getItem(SP_PREFIX + key) || defaultValue;
    } catch { return defaultValue; }
  };

  const getSessionNumber = (key: string, defaultValue: number): number => {
    try {
      const v = sessionStorage.getItem(SP_PREFIX + key);
      if (v === null) return defaultValue;
      const n = Number(v);
      return isNaN(n) ? defaultValue : n;
    } catch { return defaultValue; }
  };

  const [searchInput, setSearchInput] = useState(() => getSessionString("input", ""));
  const [query, setQuery] = useState(() => getSessionString("query", ""));
  const [loading, setLoading] = useState(true);
  const [firstLoading, setFirstLoading] = useState(() => {
    const hasCachedQuery = sessionStorage.getItem(SP_PREFIX + "query") !== null;
    return !hasCachedQuery;
  });
  const [cards, setCards] = useState<CardDoc[]>(() => getSessionValue<CardDoc[]>("cards", []));
  const [total, setTotal] = useState(() => getSessionNumber("total", 0));
  const [cardSaveStatuses, setCardSaveStatuses] = useState<Record<string, { saved: boolean; srs_state: string; review_count: number }>>(() => getSessionValue("cardSaveStatuses", {}));
  const [contentFilter, setContentFilter] = useState<string[]>(() => getSessionValue("content_filter", []));
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [page, setPage] = useState(() => getSessionNumber("page", 1));
  const [hasMore, setHasMore] = useState(() => {
    const v = sessionStorage.getItem(SP_PREFIX + "has_more");
    return v === null ? true : v === "true";
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  type ContentMetaEntry = { id: string; title?: string; type?: string; main_language?: string; level_framework_stats?: LevelFrameworkStats | null };
  const [contentMeta, setContentMeta] = useState<Record<string, ContentMetaEntry>>(() => getSessionValue("content_meta", {}));
  const [allItems, setAllItems] = useState<FilmDoc[]>([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<"up" | "down" | null>(null);
  const [practiceMode, setPracticeMode] = useState<"listening" | "reading" | "speaking" | "writing" | null>(null);
  const [minLength, setMinLength] = useState(() => getSessionNumber("min_length", 1));
  const [maxLength, setMaxLength] = useState(() => getSessionNumber("max_length", 100));
  const [maxDuration, setMaxDuration] = useState(() => getSessionNumber("max_duration", 120));
  const [minReview, setMinReview] = useState(() => getSessionNumber("min_review", 0));
  const [maxReview, setMaxReview] = useState(() => getSessionNumber("max_review", 1000));
  const [levelMin, setLevelMin] = useState<number>(() => getStoredLevelMin());
  const [levelMax, setLevelMax] = useState<number>(() => getStoredLevelMax());
  const [volume, setVolume] = useState(28);
  const [resultLayout, setResultLayout] = useState<"default" | "1-column" | "2-column">("default");
  const [contentTypeFilter, setContentTypeFilter] = useState<"all" | "movie" | "series" | "book">("all");
  const [minDifficulty] = useState(0);
  const [maxDifficulty] = useState(100);
  const [minLevel] = useState<string | null>(null);
  const [maxLevel] = useState<string | null>(null);
  const pageSize = 20;
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Persist state to sessionStorage
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "input", searchInput); } catch { /* silent */ } }, [searchInput]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "query", query); } catch { /* silent */ } }, [query]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "content_filter", JSON.stringify(contentFilter)); } catch { /* silent */ } }, [contentFilter]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "page", String(page)); } catch { /* silent */ } }, [page]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "has_more", String(hasMore)); } catch { /* silent */ } }, [hasMore]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "content_meta", JSON.stringify(contentMeta)); } catch { /* silent */ } }, [contentMeta]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "min_length", String(minLength)); } catch { /* silent */ } }, [minLength]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "max_length", String(maxLength)); } catch { /* silent */ } }, [maxLength]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "max_duration", String(maxDuration)); } catch { /* silent */ } }, [maxDuration]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "min_review", String(minReview)); } catch { /* silent */ } }, [minReview]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "max_review", String(maxReview)); } catch { /* silent */ } }, [maxReview]);
  useEffect(() => { setStoredLevelRange(levelMin, levelMax); }, [levelMin, levelMax]);
  useEffect(() => {
    const sync = () => { setLevelMin(getStoredLevelMin()); setLevelMax(getStoredLevelMax()); };
    sync();
    window.addEventListener("level-range-updated", sync);
    return () => window.removeEventListener("level-range-updated", sync);
  }, []);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "type_filter", contentTypeFilter); } catch { /* silent */ } }, [contentTypeFilter]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "cards", JSON.stringify(cards)); } catch { /* silent */ } }, [cards]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "total", String(total)); } catch { /* silent */ } }, [total]);
  useEffect(() => { try { sessionStorage.setItem(SP_PREFIX + "cardSaveStatuses", JSON.stringify(cardSaveStatuses)); } catch { /* silent */ } }, [cardSaveStatuses]);

  const fetchCards = useCallback(
    async (searchQuery: string, pageNum: number) => {
      const trimmed = searchQuery.trim();
      const isText = trimmed.length >= 2;
      const perfStart = performance.now();
      const logLabel = `[LandingPage] fetchCards ${isText ? "FTS" : "Browse"} page=${pageNum}`;

      if (isFetchingRef.current && pageNum > 1) return;

      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
      isFetchingRef.current = true;

      if (pageNum === 1) { setLoading(true); setIsLoadingMore(false); }
      else { setIsLoadingMore(true); }

      try {
        if (isText) {
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
          console.log(`${logLabel}: API took ${apiTime.toFixed(2)}ms, ${items.length} items`);

          setCards(items);
          if (content_meta && Object.keys(content_meta).length > 0) setContentMeta(prev => ({ ...prev, ...content_meta }));
          setTotal(items.length);
          setPage(pageNum);
          setHasMore(items.length === effectiveLimit && effectiveLimit < maxLimit);

          if (user?.uid && items.length > 0) {
            const cardsToLoad = items.map(card => ({
              card_id: card.id,
              film_id: card.film_id,
              episode_id: card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || "")),
            }));
            setTimeout(() => {
              apiGetCardSaveStatusBatch(user.uid!, cardsToLoad)
                .then(statuses => setCardSaveStatuses(prev => ({ ...prev, ...statuses })))
                .catch(console.error);
            }, 500);
          }
        } else {
          const apiStart = performance.now();
          const result = await apiSearch({
            query: "",
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
          console.log(`${logLabel}: API (browsing) took ${apiTime.toFixed(2)}ms, ${result.items.length} items`);

          if (result.content_meta && Object.keys(result.content_meta).length > 0) setContentMeta(prev => ({ ...prev, ...result.content_meta }));
          if (pageNum === 1) { setCards(result.items); }
          else { setCards(prev => [...prev, ...result.items]); }
          if (result.total === -1) { setTotal(result.items.length); setHasMore(result.items.length === pageSize); }
          else { setTotal(result.total); setHasMore(pageNum * pageSize < result.total); }
          setPage(pageNum);

          if (user?.uid && result.items.length > 0) {
            const cardsToLoad = result.items.map(card => ({
              card_id: card.id,
              film_id: card.film_id,
              episode_id: card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || "")),
            }));
            setTimeout(() => {
              apiGetCardSaveStatusBatch(user.uid!, cardsToLoad)
                .then(statuses => setCardSaveStatuses(prev => ({ ...prev, ...statuses })))
                .catch(console.error);
            }, 500);
          }
        }
        const totalTime = performance.now() - perfStart;
        console.log(`${logLabel}: Total ${totalTime.toFixed(2)}ms`);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          if (pageNum === 1) { setLoading(false); setFirstLoading(false); }
          else { setIsLoadingMore(false); }
          isFetchingRef.current = false;
          return;
        }
        if (pageNum === 1) { setCards([]); setTotal(0); }
      } finally {
        isFetchingRef.current = false;
        if (pageNum === 1) { setLoading(false); setFirstLoading(false); }
        else { setIsLoadingMore(false); }
      }
    },
    [preferences.main_language, preferences.subtitle_languages, pageSize, contentFilter, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, user?.uid],
  );

  const subtitleLangsKey = useMemo(() => JSON.stringify((preferences.subtitle_languages || []).sort()), [preferences.subtitle_languages]);
  const contentFilterKey = useMemo(() => JSON.stringify([...contentFilter].sort()), [contentFilter]);

  const handleSearch = useCallback((searchValue: string) => {
    const trimmed = searchValue.trim();
    setQuery(trimmed);
    setFeedbackChoice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const [isFilterModalOpenState, setIsFilterModalOpenState] = useState(false);

  useEffect(() => {
    if (isFilterModalOpenState) return;
    const trimmed = query.trim();
    if (!firstLoading) setLoading(true);
    setPage(1);
    setHasMore(true);
    setShouldShuffle(false);
    shuffleSeedRef.current = Date.now();
    fetchCards(trimmed, 1);
  }, [query, preferences.main_language, subtitleLangsKey, contentFilterKey, minDifficulty, maxDifficulty, minLevel, maxLevel, minLength, maxLength, maxDuration, minReview, maxReview, user?.uid, fetchCards, firstLoading, isFilterModalOpenState]);

  useEffect(() => {
    const handleScroll = () => { setShowBackToTop(window.scrollY > 300); };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiListItems()
      .then(items => { if (!cancelled) setAllItems(items || []); })
      .catch(e => console.error("[LandingPage] failed to load items", e));
    return () => { cancelled = true; };
  }, []);

  const filmTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allItems.length > 0) allItems.forEach((it) => { if (it?.id) map[it.id] = it.title || it.id; });
    else Object.entries(contentMeta).forEach(([, meta]) => { if (meta?.id) map[meta.id] = meta.title || meta.id; });
    return map;
  }, [allItems, contentMeta]);

  const filmTypeMap = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    if (allItems.length > 0) allItems.forEach((it) => { if (it?.id) map[it.id] = it.type; });
    else Object.entries(contentMeta).forEach(([, meta]) => { if (meta?.id) map[meta.id] = meta.type; });
    return map;
  }, [allItems, contentMeta]);

  const filmLangMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allItems.length > 0) allItems.forEach((it) => { if (it?.id && it.main_language) map[it.id] = it.main_language; });
    else Object.entries(contentMeta).forEach(([, meta]) => { if (meta?.id && meta.main_language) map[meta.id] = meta.main_language; });
    return map;
  }, [allItems, contentMeta]);

  const filmStatsMap = useMemo(() => {
    const map: Record<string, LevelFrameworkStats | null> = {};
    if (allItems.length > 0) allItems.forEach((it) => { if (it?.id) map[it.id] = (it.level_framework_stats as LevelFrameworkStats | null) ?? null; });
    else Object.entries(contentMeta).forEach(([, meta]) => { if (meta?.id) map[meta.id] = meta.level_framework_stats ?? null; });
    return map;
  }, [allItems, contentMeta]);

  const allContentIds = useMemo(() => {
    if (allItems.length > 0) return allItems.map((it) => it.id).filter(Boolean) as string[];
    return Object.values(contentMeta).map(m => m.id).filter(Boolean);
  }, [allItems, contentMeta]);

  const contentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of cards) {
      const contentId = card.film_id;
      if (contentId) counts[contentId] = (counts[contentId] || 0) + 1;
    }
    if (allContentIds && allContentIds.length > 0) {
      for (const id of allContentIds) {
        if (!(id in counts)) counts[id] = 0;
      }
    }
    return counts;
  }, [cards, allContentIds]);

  const [shouldShuffle, setShouldShuffle] = useState(false);
  const shuffleSeedRef = useRef<number>(Date.now());

  const filteredCards = useMemo(() => {
    if (cards.length === 0) return [];
    let list = cards;
    if (contentTypeFilter !== "all") {
      list = cards.filter(c => c.film_id != null && filmTypeMap[c.film_id] === contentTypeFilter);
    }
    const params = new URLSearchParams(window.location.search);
    const levelFilter = params.get("level");
    if (levelFilter) {
      const normalizedLevel = levelFilter.toUpperCase();
      list = list.filter(card =>
        Array.isArray(card.levels) && card.levels.some(lvl => (lvl.level || "").toUpperCase() === normalizedLevel)
      );
    }
    if (levelMin >= 0 && levelMax >= 0 && levelMax > levelMin) {
      const normalize = (s: string) => String(s || "").trim().toLowerCase();
      list = list.filter(card => {
        if (!Array.isArray(card.level_frequency_ranks) || card.level_frequency_ranks.length === 0) return false;
        const primaryFramework = card.levels?.[0]?.framework || "CEFR";
        const frameworkKey = normalize(primaryFramework);
        const freqEntry = card.level_frequency_ranks.find(f => normalize(f.framework) === frameworkKey) || card.level_frequency_ranks[0];
        const freqRank = typeof freqEntry?.frequency_rank === "number" ? Math.round(freqEntry.frequency_rank) : null;
        if (freqRank == null) return false;
        return freqRank >= levelMin && freqRank <= levelMax;
      });
    }
    if (!shouldShuffle) return list;
    const shuffled = [...list];
    let seed = shuffleSeedRef.current;
    const seededRandom = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [cards, contentTypeFilter, shouldShuffle, filmTypeMap, levelMin, levelMax]);

  const availableTypesFromSelection = useMemo(() => {
    const set = new Set<"movie" | "series" | "book">();
    for (const fid of contentFilter) {
      const t = (filmTypeMap[fid] || "").toLowerCase();
      if (t === "movie" || t === "series" || t === "book") set.add(t);
    }
    return set;
  }, [contentFilter, filmTypeMap]);

  const handleContentTypeChange = useCallback((nextType: "all" | "movie" | "series" | "book") => {
    setContentTypeFilter(nextType);
    if (nextType === "all") return;
    setContentFilter(prev => prev.filter(fid => (filmTypeMap[fid] || "").toLowerCase() === nextType));
  }, [filmTypeMap]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || isLoadingMore || isFetchingRef.current) return;
    fetchCards(query, page + 1);
  }, [hasMore, loading, isLoadingMore, page, query, fetchCards]);

  const handleLengthChange = useCallback((min: number, max: number) => { setMinLength(min); setMaxLength(max); }, []);
  const handleDurationChange = useCallback((max: number) => { setMaxDuration(max); }, []);
  const handleReviewChange = useCallback((min: number, max: number) => { setMinReview(min); setMaxReview(max); }, []);

  return (
    <div className="landing-page-container">
      {/* Left icon sidebar */}
      <div className="landing-sidebar">
        <div className="landing-sidebar-top">
          <button
            className="landing-sidebar-btn"
            onClick={() => navigate("/")}
            title="Home"
          >
            <img src={starIcon} alt="Home" />
          </button>
          <button
            className="landing-sidebar-btn"
            onClick={() => navigate("/search")}
            title="Search"
          >
            <img src={searchIcon} alt="Search" />
          </button>
        </div>
        <div className="landing-sidebar-blue-line" />
        <div className="landing-sidebar-nav">
          <button
            className="landing-sidebar-btn"
            onClick={() => navigate("/content")}
            title="Media"
          >
            <img src={mediaIcon} alt="Media" />
          </button>
          <button
            className="landing-sidebar-btn"
            onClick={() => navigate("/saved")}
            title="Saved"
          >
            <img src={saveHeartIcon} alt="Saved" />
          </button>
          <button
            className="landing-sidebar-btn"
            onClick={() => navigate("/watchlist")}
            title="Watchlist"
          >
            <img src={watchlistIcon} alt="Watchlist" />
          </button>
        </div>
      </div>

      {/* Overlay for filter panel */}
      {isFilterPanelOpen && (
        <div
          className="filter-panel-overlay"
          onClick={() => setIsFilterPanelOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Filter panel (reused from SearchPage, narrower) */}
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

      {/* Main content */}
      <div className={`landing-layout-wrapper ${!isFilterPanelOpen ? "filter-panel-closed" : ""}`}>
        <main className="landing-main">
          {/* Search controls row */}
          <div className="landing-search-controls">
            <div className="landing-bar-container">
              <button
                className={`landing-toggle-btn ${isFilterPanelOpen ? "active" : ""}`}
                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                aria-label={isFilterPanelOpen ? "Close filter panel" : "Open filter panel"}
              >
                <img
                  src={rightAngleIcon}
                  alt="Toggle filter"
                  className={isFilterPanelOpen ? "rotate-180" : ""}
                />
              </button>
              <SearchBar
                value={searchInput}
                onChange={v => setSearchInput(v)}
                onSearch={handleSearch}
                placeholder=""
                loading={loading || firstLoading}
                enableAutocomplete={true}
                language={preferences.main_language || "en"}
              />
              <div className="practice-wrapper">
                <button
                  type="button"
                  className={`practice-btn ${isPracticeOpen ? "open" : ""}`}
                  onClick={() => setIsPracticeOpen(prev => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={isPracticeOpen}
                >
                  <img src={practiceMonsterIcon} alt="Practice" className="practice-icon" />
                  <span className="practice-label">Practice</span>
                  <span className="practice-divider" aria-hidden="true" />
                  <img src={rightAngleIcon} alt="" className="practice-chevron-icon" aria-hidden="true" />
                </button>
                {isPracticeOpen && (
                  <div className="practice-dropdown" role="menu">
                    <button
                      type="button"
                      className={`practice-dropdown-item ${practiceMode === "listening" ? "selected" : ""}`}
                      onClick={() => { setPracticeMode("listening"); setIsPracticeOpen(false); }}
                      role="menuitem"
                    >
                      <img src={headphoneIcon} alt="" className="practice-item-icon" />
                      <span>Listening</span>
                    </button>
                    <button
                      type="button"
                      className={`practice-dropdown-item ${practiceMode === "speaking" ? "selected" : ""}`}
                      onClick={() => { setPracticeMode("speaking"); setIsPracticeOpen(false); }}
                      role="menuitem"
                    >
                      <img src={speakIcon} alt="" className="practice-item-icon" />
                      <span>Speaking</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                className="landing-toggle-btn"
                onClick={() => {}}
                aria-label="Open information"
              >
                <img src={informationIcon} alt="Information" />
              </button>
              <button
                className="landing-toggle-btn"
                onClick={() => {
                  setIsFilterModalOpen(true);
                  setIsFilterModalOpenState(true);
                }}
                aria-label="Open filters"
              >
                <img src={filterIcon} alt="Filter" />
              </button>
              <button
                className="landing-toggle-btn"
                onClick={() => setIsCustomizeModalOpen(true)}
                aria-label="Customize"
              >
                <img src={customIcon} alt="Customize" />
              </button>
            </div>

            <div className="landing-stats typography-inter-4">
              <SubtitleLanguageSelector className="search-subtitle-selector" />
              <span className="search-stats-text">
                {loading ? "Searching..." : `${total} Cards`}
              </span>
            </div>
            <div className="content-type-filter" role="group" aria-label="Content type">
              {(["all", "movie", "series", "book"] as const)
                .filter(type => type === "all" || availableTypesFromSelection.size === 0 || availableTypesFromSelection.has(type))
                .map(type => (
                  <button
                    key={type}
                    type="button"
                    className={`content-type-option typography-noto-content-type ${contentTypeFilter === type ? "active" : ""}`}
                    onClick={() => handleContentTypeChange(type)}
                    aria-pressed={contentTypeFilter === type}
                  >
                    {type === "all" ? "All" : CONTENT_TYPE_LABELS[type as ContentType]}
                  </button>
                ))}
            </div>
          </div>

          {/* Results area */}
          <div className={`landing-results layout-${resultLayout === "default" ? "default" : resultLayout === "1-column" ? "1-column" : "2-column"} ${!isFilterPanelOpen ? "filter-panel-closed" : ""}`}>
            {loading && cards.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className="search-card-skeleton"
                    style={{
                      height: "300px",
                      background: "linear-gradient(90deg, var(--hover-bg) 25%, var(--hover-bg-subtle) 50%, var(--hover-bg) 75%)",
                      backgroundSize: "200% 100%",
                      animation: "skeleton-loading 1.5s ease-in-out infinite",
                      borderRadius: "8px",
                      marginBottom: "1rem",
                    }}
                  />
                ))
              : (
                <>
                  {filteredCards.map(card => {
                    const stableKey = `${card.film_id || "item"}-${card.episode_id || card.episode || "e"}-${card.id}`;
                    const saveStatus = cardSaveStatuses[card.id] || { saved: false, srs_state: "none", review_count: 0 };
                    const titleFromMeta = (card.film_id && filmTitleMap[card.film_id]) || undefined;
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
                              if (k.startsWith("gg_save:")) sessionStorage.removeItem(k);
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
                      background: "linear-gradient(90deg, var(--hover-bg) 25%, var(--hover-bg-subtle) 50%, var(--hover-bg) 75%)",
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
                        className={`search-feedback-icon-btn ${feedbackChoice === "up" ? "selected" : ""}`}
                        onClick={() => setFeedbackChoice(prev => prev === "up" ? null : "up")}
                        aria-pressed={feedbackChoice === "up"}
                        aria-label="Thumbs up"
                      >
                        <img src={thumbUpIcon} alt="" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`search-feedback-icon-btn ${feedbackChoice === "down" ? "selected" : ""}`}
                        onClick={() => setFeedbackChoice(prev => prev === "down" ? null : "down")}
                        aria-pressed={feedbackChoice === "down"}
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
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
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

export default LandingPage;
