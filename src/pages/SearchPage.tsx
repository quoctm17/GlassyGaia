import { useEffect, useState, useMemo } from "react";
import { useLocation } from "react-router-dom";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc, LevelFrameworkStats } from "../types";
import { listAllItems } from "../services/firestore";
import FilterPanel from "../components/FilterPanel";
import FilterModal from "../components/FilterModal";
import CustomizeModal from "../components/CustomizeModal";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";
import Pagination from "../components/Pagination";
import { hasJapanese, toHiragana } from "../utils/japanese";
import mediaIcon from "../assets/icons/media.svg";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import filterIcon from "../assets/icons/filter.svg";
import customIcon from "../assets/icons/custom.svg";
import "../styles/pages/search-page.css";

function SearchPage() {
  const { preferences, setVolume, setResultLayout } = useUser();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // Derive loading state from actual fetch; avoid a separate 'searching' toggle to prevent spinner flicker
  const [allResults, setAllResults] = useState<CardDoc[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  // hasMore no longer used with numbered pagination
  const [total, setTotal] = useState<number>(0); // paginator total (scoped when film selected)
  const [globalTotal, setGlobalTotal] = useState<number>(0); // always global All Sources total
  const [contentCounts, setContentCounts] = useState<Record<string, number>>({});
  const [filmFilter, setFilmFilter] = useState<string | null>(null);
  const [filmTitleMap, setFilmTitleMap] = useState<Record<string, string>>({});
  const [films, setFilms] = useState<string[]>([]);
  const [filmTypeMap, setFilmTypeMap] = useState<Record<string, string>>({});
  const [filmStatsMap, setFilmStatsMap] = useState<Record<string, LevelFrameworkStats | null>>({});
  const [minDifficulty, setMinDifficulty] = useState<number>(0);
  const [maxDifficulty, setMaxDifficulty] = useState<number>(100);
  const [minLevel, setMinLevel] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(300); // resizable panel width
  const [dragging, setDragging] = useState<boolean>(false);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});
  const [filterPanelOpen, setFilterPanelOpen] = useState<boolean>(true); // Filter panel visibility
  const [isMobile, setIsMobile] = useState<boolean>(false); // Track if mobile/tablet
  const [filterModalOpen, setFilterModalOpen] = useState<boolean>(false); // Filter modal visibility
  const [customizeModalOpen, setCustomizeModalOpen] = useState<boolean>(false); // Customize modal visibility
  // removed filmAvailMap (unused after suggestion source simplification)

  // Detect mobile/tablet screen
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      // Close filter panel by default on mobile
      if (mobile) {
        setFilterPanelOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // LanguageSelector writes to preferences directly; no local mirror needed

  const fetchPage = async (q: string, pageNum: number, sizeOverride?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('q', q || '');
      // For Japanese queries, also provide an alternate bracketed reading form to help backend matching
      // Require minimum 2 characters for hiragana/katakana to avoid overly broad partial matches
      if (q && hasJapanese(q)) {
        const hira = toHiragana(q);
        // Only send normalized variants if query is at least 2 chars (to avoid matching too broadly)
        const minLength = /^[\u3040-\u309F\u30A0-\u30FF]+$/.test(q.trim()) ? 2 : 1; // 2 for pure kana, 1 for kanji
        if (hira && q.trim().length >= minLength) {
          params.set('q_hira', hira);
          params.set('q_bracket', `[${hira}]`);
        }
      }
      if (preferences.main_language) params.set('main_language', preferences.main_language);
      // Backend filters
      params.set('minDifficulty', String(minDifficulty));
      params.set('maxDifficulty', String(maxDifficulty));
      // Level framework filters
      if (minLevel) params.set('minLevel', minLevel);
      if (maxLevel) params.set('maxLevel', maxLevel);
      // Do NOT pass content type when a specific film is selected.
      // We want server totals/per-content counts to remain global across all contents.
      // Pass all selected subtitle languages (CSV) up to 3
      const subsArr = Array.isArray(preferences.subtitle_languages) ? preferences.subtitle_languages : [];
      if (subsArr.length) params.set('subtitle_languages', subsArr.join(','));
      // Scope to a specific content when selected so pagination is per-content
      if (filmFilter) params.set('content_slug', filmFilter);
      params.set('page', String(pageNum));
      params.set('size', String(sizeOverride ?? pageSize));
      const base = ((import.meta as unknown) as { env?: Record<string, string | undefined> }).env?.VITE_WORKER_BASE || '';
      const apiUrl = base ? `${base.replace(/\/$/, '')}/api/search?${params.toString()}` : `/api/search?${params.toString()}`;
      const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!/application\/json/i.test(ct)) {
        const text = await res.text();
        throw new Error(`Non-JSON response: ${text.slice(0, 120)}...`);
      }
      const payload = await res.json();
      // Legacy mapper removed; worker now returns full media URLs
      const mapped: CardDoc[] = (payload.items || []).map((r: Record<string, unknown>) => {
        const imgKey = typeof r.image_key === 'string' ? r.image_key : '';
        const audKey = typeof r.audio_key === 'string' ? r.audio_key : '';
        const imgUrl = typeof r.image_url === 'string' ? r.image_url : '';
        const audUrl = typeof r.audio_url === 'string' ? r.audio_url : '';
        const img = imgUrl || (imgKey ? `/media/${imgKey}` : '');
        const aud = audUrl || (audKey ? `/media/${audKey}` : '');
        const lang = typeof r.language === 'string' ? r.language : '';
        const subs: Record<string, string> = {};
        if (lang && typeof r.text === 'string') subs[lang] = r.text as string;
        if (typeof r.subs_json === 'string' && r.subs_json) {
          try {
            const extra = JSON.parse(r.subs_json as string);
            if (extra && typeof extra === 'object') {
              for (const k of Object.keys(extra)) {
                if (typeof (extra as Record<string, unknown>)[k] === 'string') subs[k] = (extra as Record<string, string>)[k];
              }
            }
          } catch { /* ignore parse error */ }
        }
        const cardId = typeof r.card_id === 'string' ? r.card_id : (typeof r.card_id === 'number' ? String(r.card_id) : '');
        const contentSlug = typeof r.content_slug === 'string' ? r.content_slug : '';
        const episodeSlug = typeof r.episode_slug === 'string' ? r.episode_slug : '';
        const episodeNum = typeof r.episode_number === 'number' ? r.episode_number : Number.isFinite(Number(r.episode_number)) ? Number(r.episode_number) : 0;
        const startTime = typeof r.start_time === 'number' ? r.start_time : Number.isFinite(Number(r.start_time)) ? Number(r.start_time) : 0;
        const endTime = typeof r.end_time === 'number' ? r.end_time : Number.isFinite(Number(r.end_time)) ? Number(r.end_time) : 0;
        const difficulty = typeof r.difficulty_score === 'number' ? r.difficulty_score : Number.isFinite(Number(r.difficulty_score)) ? Number(r.difficulty_score) : undefined;
        // Parse levels array
        let levels: Array<{ framework: string; level: string; language?: string }> | undefined = undefined;
        if (Array.isArray(r.levels)) {
          levels = r.levels as Array<{ framework: string; level: string; language?: string }>;
        } else if (typeof r.levels_json === 'string' && r.levels_json) {
          try {
            const parsed = JSON.parse(r.levels_json as string);
            if (Array.isArray(parsed)) levels = parsed;
          } catch { /* ignore */ }
        }
        return {
          id: String(cardId),
          film_id: String(contentSlug),
          episode_id: String(episodeSlug || (episodeNum ? `e${episodeNum}` : '')),
          episode: Number(episodeNum ?? 0),
          image_url: img,
          audio_url: aud,
          start: Number(startTime ?? 0),
          end: Number(endTime ?? 0),
          difficulty_score: difficulty,
          sentence: typeof r.text === 'string' ? (r.text as string) : undefined,
          subtitle: subs,
          levels,
        };
      });
      const perContent = payload.per_content || {};
      setContentCounts(perContent);
      const totalVal = filmFilter
        ? Number(perContent?.[filmFilter] ?? 0)
        : Number(payload.total ?? 0);
      setTotal(totalVal);
      // Keep global total regardless of current film selection
      setGlobalTotal(Number(payload.total ?? 0));
      // In pagination mode we replace the list on each fetch
      setAllResults(mapped);
    } catch (e) {
      // Gracefully handle initial empty DB / 404
      console.warn(
        "Search fetch error (treated as empty):",
        (e as Error)?.message
      );
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (q: string) => {
    setPage(1);
    // If query contains Japanese, normalize to Hiragana before sending to backend
    // But require minimum length to avoid overly broad partial matches
    let qToSend = q;
    if (hasJapanese(q)) {
      const minLength = /^[\u3040-\u309F\u30A0-\u30FF]+$/.test(q.trim()) ? 2 : 1;
      if (q.trim().length >= minLength) {
        qToSend = toHiragana(q);
      }
    }
    await fetchPage(qToSend, 1);
  };

  useEffect(() => {
    runSearch("");
    // preload film titles for facet labels
    listAllItems()
      .then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const typeMap: Record<string, string> = {};
        const statsMap: Record<string, LevelFrameworkStats | null> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.type) typeMap[f.id] = f.type;
          // Parse level_framework_stats
          if (f.level_framework_stats) {
            try {
              const parsed = typeof f.level_framework_stats === 'string'
                ? JSON.parse(f.level_framework_stats)
                : f.level_framework_stats;
              statsMap[f.id] = Array.isArray(parsed) ? parsed : null;
            } catch {
              statsMap[f.id] = null;
            }
          } else {
            statsMap[f.id] = null;
          }
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmTypeMap(typeMap);
        setFilmStatsMap(statsMap);
      })
      .catch((e) => {
        console.warn(
          "Films fetch error (treated as empty):",
          (e as Error)?.message
        );
        setFilmTitleMap({});
        setFilms([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]); // Refresh whenever navigation occurs to this page

  // Listen for content updates (uploads/deletes) to refresh lists and search
  useEffect(() => {
    const handler = () => {
      runSearch(query);
      listAllItems().then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const typeMap: Record<string, string> = {};
        const statsMap: Record<string, LevelFrameworkStats | null> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.type) typeMap[f.id] = f.type;
          // Parse level_framework_stats
          if (f.level_framework_stats) {
            try {
              const parsed = typeof f.level_framework_stats === 'string'
                ? JSON.parse(f.level_framework_stats)
                : f.level_framework_stats;
              statsMap[f.id] = Array.isArray(parsed) ? parsed : null;
            } catch {
              statsMap[f.id] = null;
            }
          } else {
            statsMap[f.id] = null;
          }
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmTypeMap(typeMap);
        setFilmStatsMap(statsMap);
      }).catch(() => {});
    };
    window.addEventListener('content-updated', handler);
    return () => window.removeEventListener('content-updated', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // When film language map loads/changes, refresh search to honor primary language-only semantics
  useEffect(() => {
    // only rerun if we already have results or query has content to avoid extra initial flicker
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmLangMap, preferences.main_language]);

  // Debounced live search on query changes
  useEffect(() => {
    const handle = setTimeout(() => {
      runSearch(query);
    }, 350);
    return () => {
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Re-run when subtitle language preference changes (after Done in selector)
  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.subtitle_languages]);

  // Re-run when difficulty, level framework, or film filter changes
  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDifficulty, maxDifficulty, minLevel, maxLevel, filmFilter]);


  // no film/episode context in global search

  // Only show films that have at least one matching result to avoid long lists of zero counts.
  const filmsWithResults = useMemo(() => {
    const counts = contentCounts;
    return films.filter(id => (counts[id] || 0) > 0);
  }, [films, contentCounts]);

  // Reset film filter if current selection no longer has results for active query
  useEffect(() => {
    if (filmFilter && !filmsWithResults.includes(filmFilter)) {
      setFilmFilter(null);
    }
  }, [filmFilter, filmsWithResults]);

  // Rely on server-side filters for difficulty and content scoping.
  const displayedResults = allResults;

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const newWidth = Math.min(600, Math.max(200, e.clientX));
    setSidebarWidth(newWidth);
  };
  const stopDrag = () => setDragging(false);

  const toggleFilterPanel = () => {
    setFilterPanelOpen(prev => !prev);
  };

  return (
    <div className="search-layout-wrapper" onMouseMove={onMove} onMouseUp={stopDrag}>
      {/* Mobile/Tablet overlay - only show on small screens */}
      {isMobile && filterPanelOpen && (
        <div 
          className="filter-panel-overlay"
          onClick={toggleFilterPanel}
          aria-hidden="true"
        />
      )}
      
      <div className="search-flex-row" style={{ display: 'flex' }}>
        <aside className={`filter-panel flex-shrink-0 ${filterPanelOpen ? 'open' : 'closed'}`} style={{ width: sidebarWidth }}>
          {/* Close button for mobile/tablet */}
          <button
            onClick={toggleFilterPanel}
            className="filter-panel-close-btn"
            aria-label="Close filters"
          >
            ✕
          </button>
          <FilterPanel
            filmTitleMap={filmTitleMap}
            filmTypeMap={filmTypeMap}
            filmLangMap={filmLangMap}
            filmStatsMap={filmStatsMap}
            allResults={allResults}
            contentCounts={contentCounts}
            totalCount={globalTotal}
            filmFilter={filmFilter}
            onSelectFilm={(id) => setFilmFilter(filmFilter === id ? null : id)}
            mainLanguage={preferences.main_language || "en"}
          />
        </aside>
        <div
          className={`vertical-resizer ${dragging ? 'dragging' : ''}`}
          onMouseDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize filters"
        />
        <main className="search-main flex-1">
        <div className="search-controls">
          <div className="w-full flex gap-3 items-center mb-2">
            <button
              onClick={toggleFilterPanel}
              className="filter-toggle-btn"
              aria-label={filterPanelOpen ? "Close filters" : "Open filters"}
              title={filterPanelOpen ? "Close filters" : "Open filters"}
            >
              <img 
                src={rightAngleIcon} 
                alt="Toggle" 
                className={`filter-toggle-icon ${filterPanelOpen ? 'rotate' : ''}`}
              />
              <img src={mediaIcon} alt="Content" className="filter-toggle-icon" />
            </button>
            <SearchBar
              value={query}
              onChange={(v) => setQuery(v)}
              onClear={() => {
                setFilmFilter(null);
              }}
              placeholder={`Search across all films...`}
              loading={loading}
            />
            <button 
              className={`filter-toggle-icon-button ${filterModalOpen ? 'active' : ''}`}
              onClick={() => setFilterModalOpen(true)}
              aria-label="Open filters"
            >
              <img src={filterIcon} alt="Filters" className="filter-toggle-icon" />
            </button>
            <button 
              className={`filter-toggle-icon-button ${customizeModalOpen ? 'active' : ''}`}
              onClick={() => setCustomizeModalOpen(true)}
              aria-label="Customize view"
            >
              <img src={customIcon} alt="Customize" className="filter-toggle-icon" />
            </button>
            
            <FilterModal 
              isOpen={filterModalOpen}
              onClose={() => setFilterModalOpen(false)}
              minDifficulty={minDifficulty}
              maxDifficulty={maxDifficulty}
              onDifficultyChange={(min, max) => { setMinDifficulty(min); setMaxDifficulty(max); }}
              minLevel={minLevel}
              maxLevel={maxLevel}
              onLevelChange={(min, max) => { setMinLevel(min); setMaxLevel(max); }}
              mainLanguage={preferences.main_language || "en"}
            />
            
            <CustomizeModal 
              isOpen={customizeModalOpen}
              onClose={() => setCustomizeModalOpen(false)}
              volume={preferences.volume || 80}
              onVolumeChange={(vol) => setVolume(vol)}
              resultLayout={preferences.resultLayout || 'default'}
              onLayoutChange={(layout) => setResultLayout(layout)}
            />
          </div>

          <div className="flex justify-between items-center mb-4" style={{ paddingLeft: '8rem', paddingRight: '8rem' }}>
            <div className="flex items-center gap-2 cursor-pointer">
              <span className="typography-inter-3" style={{ color: 'var(--neutral)' }}>
                Search By
              </span>
              <img 
                src={rightAngleIcon} 
                alt="Dropdown" 
                style={{ 
                  width: '16px', 
                  height: '16px', 
                  transform: 'rotate(90deg)',
                  filter: 'var(--icon-neutral-filter)'
                }}
              />
            </div>
            <span className="typography-inter-3" style={{ color: 'var(--neutral)' }}>
              {loading ? "Searching..." : filmFilter ? `${total} Results` : `${globalTotal} Results`}
            </span>
          </div>
        </div>

        <div className={
          preferences.resultLayout === 'default' 
            ? (filterPanelOpen ? '' : 'grid grid-cols-2 gap-4')
            : preferences.resultLayout === '2-column'
            ? 'grid grid-cols-2 gap-4'
            : ''
        }>
          {displayedResults.map((c) => (
            <SearchResultCard
              key={String(c.id)}
              card={c}
              highlightQuery={query}
              primaryLang={filmLangMap[String(c.film_id ?? "")]}
              filmTitle={filmTitleMap[String(c.film_id ?? "")]}
            />
          ))}
        </div>

        <div className="mt-6">
          <Pagination
            mode="count"
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            onPageChange={(p: number) => { setPage(p); fetchPage(query, p); }}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
              // Ensure server returns correct page size immediately
              fetchPage(query, 1, s);
            }}
          />
        </div>
        </main>
      </div>
    </div>
  );
}

export default SearchPage;
