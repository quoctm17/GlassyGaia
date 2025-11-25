import { useEffect, useState, useMemo } from "react";
import { useLocation } from "react-router-dom";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";
import { searchCardsGlobalClient, listAllItems } from "../services/firestore";
// Replaced old SearchFilters with new FilterPanel + ContentSelector
import FilterPanel from "../components/FilterPanel";
// Removed old LanguageSelector (now in NavBar via MainLanguageSelector & SubtitleLanguageSelector)
import SuggestionPanel from "../components/SuggestionPanel";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";

function SearchPage() {
  const { preferences } = useUser();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // Derive loading state from actual fetch; avoid a separate 'searching' toggle to prevent spinner flicker
  const [allResults, setAllResults] = useState<CardDoc[]>([]);
  const [filmFilter, setFilmFilter] = useState<string | null>(null);
  const [filmTitleMap, setFilmTitleMap] = useState<Record<string, string>>({});
  const [films, setFilms] = useState<string[]>([]);
  const [filmTypeMap, setFilmTypeMap] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<number>(100);
  const [minDifficulty, setMinDifficulty] = useState<number>(0);
  const [maxDifficulty, setMaxDifficulty] = useState<number>(100);
  const [sidebarWidth, setSidebarWidth] = useState<number>(300); // resizable panel width
  const [dragging, setDragging] = useState<boolean>(false);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});
  // removed filmAvailMap (unused after suggestion source simplification)

  // LanguageSelector writes to preferences directly; no local mirror needed

  const runSearch = async (q: string) => {
    setLoading(true);
    try {
      // Request a reasonably sized pool; the underlying service caches to avoid repeated fetches
      const desiredPool = Math.min(3000, Math.max(400, limit + 300));
      const data = await searchCardsGlobalClient(
        q,
        desiredPool,
        null,
        filmLangMap,
        preferences.main_language
      );
      setAllResults(data);
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

  useEffect(() => {
    // initial load and refresh whenever user navigates to this page
    runSearch("");
    // preload film titles for facet labels
    listAllItems()
      .then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const typeMap: Record<string, string> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.type) typeMap[f.id] = f.type;
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmTypeMap(typeMap);
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
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.type) typeMap[f.id] = f.type;
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmTypeMap(typeMap);
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


  // no film/episode context in global search

  // Only show films that have at least one matching result to avoid long lists of zero counts.
  const filmsWithResults = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allResults) {
      const fid = String(c.film_id ?? "");
      if (!fid) continue;
      counts[fid] = (counts[fid] || 0) + 1;
    }
    return films.filter(id => counts[id] > 0);
  }, [films, allResults]);

  // Reset film filter if current selection no longer has results for active query
  useEffect(() => {
    if (filmFilter && !filmsWithResults.includes(filmFilter)) {
      setFilmFilter(null);
    }
  }, [filmFilter, filmsWithResults]);

  // Apply difficulty filtering client-side
  const difficultyFiltered = allResults.filter(c => {
    const score = typeof c.difficulty_score === 'number' ? c.difficulty_score : 0;
    return score >= minDifficulty && score <= maxDifficulty;
  });

  const displayedResults = (filmFilter
    ? difficultyFiltered.filter(c => c.film_id === filmFilter)
    : difficultyFiltered).slice(0, limit);

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

  return (
    <div className={`search-layout-wrapper p-6`} onMouseMove={onMove} onMouseUp={stopDrag}>
      <div className="search-flex-row" style={{ display: 'flex' }}>
        <aside className="filter-panel flex-shrink-0" style={{ width: sidebarWidth }}>
          <FilterPanel
            filmTitleMap={filmTitleMap}
            filmTypeMap={filmTypeMap}
            filmLangMap={filmLangMap}
            allResults={difficultyFiltered}
            filmFilter={filmFilter}
            onSelectFilm={(id) => setFilmFilter(id)}
            minDifficulty={minDifficulty}
            maxDifficulty={maxDifficulty}
            onDifficultyChange={(min, max) => { setMinDifficulty(min); setMaxDifficulty(max); }}
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
        <SearchBar
          value={query}
          onChange={(v) => setQuery(v)}
          onSearch={(v) => runSearch(v)}
          onClear={() => {
            setFilmFilter(null);
          }}
          placeholder={`Search across all films...`}
          buttonLabel="SEARCH"
          loading={loading}
        />

        {/* Subtitle language selection moved to NavBar */}

        {(() => {
          const filtered = filmFilter
            ? allResults.filter((c) => c.film_id === filmFilter)
            : allResults;
          return (
            <div className="mt-4 text-sm text-pink-200/80">
              {loading ? "Đang tìm..." : `Tổng ${filtered.length} kết quả`}
            </div>
          );
        })()}

        {/* Suggestions when no query */}
        {query.trim().length === 0 && (
          <SuggestionPanel
            filmId={"all"}
            onPick={(q) => {
              setQuery(q);
              runSearch(q);
            }}
          />
        )}

        <div className="mt-4 space-y-3">
          {displayedResults.map((c) => (
            <SearchResultCard
              key={`${c.film_id}-${c.episode_id}-${c.id}`}
              card={c}
              highlightQuery={query}
              primaryLang={filmLangMap[String(c.film_id ?? "")]}
            />
          ))}
        </div>

        <div className="mt-4 flex justify-center">
          <button
            className="pixel-load-more"
            onClick={() => {
              const next = limit + 100;
              setLimit(next);
            }}
          >
            Load more
          </button>
        </div>
        </main>
      </div>
    </div>
  );
}

export default SearchPage;
