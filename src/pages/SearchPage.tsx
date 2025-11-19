import { useEffect, useState } from "react";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";
import { searchCardsGlobalClient, listAllItems } from "../services/firestore";
import SearchFilters from "../components/SearchFilters";
// Removed old LanguageSelector (now in NavBar via MainLanguageSelector & SubtitleLanguageSelector)
import SuggestionPanel from "../components/SuggestionPanel";
import { canonicalizeLangCode } from "../utils/lang";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";

function SearchPage() {
  const { preferences } = useUser();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // Derive loading state from actual fetch; avoid a separate 'searching' toggle to prevent spinner flicker
  const [allResults, setAllResults] = useState<CardDoc[]>([]);
  const [availableLangs, setAvailableLangs] = useState<string[]>(["en"]);
  const [filmFilter, setFilmFilter] = useState<string | null>(null);
  const [filmTitleMap, setFilmTitleMap] = useState<Record<string, string>>({});
  const [films, setFilms] = useState<string[]>([]);
  const [filmTypeMap, setFilmTypeMap] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<number>(100);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});
  const [filmAvailMap, setFilmAvailMap] = useState<Record<string, string[]>>(
    {}
  );

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
    // initial load
    runSearch("");
    // preload film titles for facet labels
    listAllItems()
      .then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const availMap: Record<string, string[]> = {};
        const typeMap: Record<string, string> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.available_subs) availMap[f.id] = f.available_subs;
          if (f.type) typeMap[f.id] = f.type;
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmAvailMap(availMap);
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
  }, []);

  // Listen for content updates (uploads/deletes) to refresh lists and search
  useEffect(() => {
    const handler = () => {
      runSearch(query);
      listAllItems().then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const availMap: Record<string, string[]> = {};
        const typeMap: Record<string, string> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.available_subs) availMap[f.id] = f.available_subs;
          if (f.type) typeMap[f.id] = f.type;
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmAvailMap(availMap);
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

  // Recompute available languages from results so selector is dynamic like CardDetail
  useEffect(() => {
    // Derive available subtitle languages from the union of available_subs for films present in the (optionally filtered) results
    const ids = new Set<string>(
      (filmFilter
        ? allResults.filter((c) => c.film_id === filmFilter)
        : allResults
      ).map((c) => String(c.film_id ?? ""))
    );
    const acc = new Set<string>();
    ids.forEach((fid) => {
      const arr = filmAvailMap[fid] || [];
      arr.forEach((l) => acc.add(canonicalizeLangCode(l) || l));
    });
    const out = Array.from(acc);
    out.sort((a, b) => {
      if (a === "en" && b !== "en") return -1;
      if (b === "en" && a !== "en") return 1;
      return a.localeCompare(b);
    });
    if (out.length) setAvailableLangs(out);
  }, [allResults, filmFilter, filmAvailMap]);

  // no film/episode context in global search

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      {/* Left column: filters */}
      <SearchFilters
        films={films}
        filmTitleMap={filmTitleMap}
        filmTypeMap={filmTypeMap}
        allResults={allResults}
        filmFilter={filmFilter}
        onSelect={(id) => setFilmFilter(id)}
      />

      {/* Right column: search + results */}
      <main className="col-span-12 md:col-span-9">
        <SearchBar
          value={query}
          onChange={(v) => setQuery(v)}
          onSearch={(v) => runSearch(v)}
          onClear={() => {
            setFilmFilter(null);
          }}
          placeholder={`Search across all films...`}
          buttonLabel="Search by"
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
            languages={availableLangs}
            onPick={(q) => {
              setQuery(q);
              runSearch(q);
            }}
          />
        )}

        <div className="mt-4 space-y-3">
          {(filmFilter
            ? allResults.filter((c) => c.film_id === filmFilter)
            : allResults
          )
            .slice(0, limit)
            .map((c) => (
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
  );
}

export default SearchPage;
