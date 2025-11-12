import { useEffect, useState } from "react";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";
import { searchCardsGlobalClient, listFilms } from "../services/firestore";
// Removed old LanguageSelector (now in NavBar via MainLanguageSelector & SubtitleLanguageSelector)
import SuggestionPanel from "../components/SuggestionPanel";
import { canonicalizeLangCode } from "../utils/lang";
import SearchBar from "../components/SearchBar";
import { useUser } from "../context/UserContext";

function SearchPage() {
  const { preferences } = useUser();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [allResults, setAllResults] = useState<CardDoc[]>([]);
  const [availableLangs, setAvailableLangs] = useState<string[]>(["en"]);
  const [filmFilter, setFilmFilter] = useState<string | null>(null);
  const [filmTitleMap, setFilmTitleMap] = useState<Record<string, string>>({});
  const [films, setFilms] = useState<string[]>([]);
  const [limit, setLimit] = useState<number>(100);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});
  const [filmAvailMap, setFilmAvailMap] = useState<Record<string, string[]>>(
    {}
  );

  // LanguageSelector writes to preferences directly; no local mirror needed

  const runSearch = async (q: string) => {
    setLoading(true);
    try {
      const data = await searchCardsGlobalClient(q, 3000, null, filmLangMap, preferences.main_language);
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
    listFilms()
      .then((fs) => {
        const titleMap: Record<string, string> = {};
        const order: string[] = [];
        const langMap: Record<string, string> = {};
        const availMap: Record<string, string[]> = {};
        fs.forEach((f) => {
          titleMap[f.id] = f.title || f.id;
          order.push(f.id);
          if (f.main_language) langMap[f.id] = f.main_language;
          if (f.available_subs) availMap[f.id] = f.available_subs;
        });
        setFilmTitleMap(titleMap);
        setFilms(order);
        setFilmLangMap(langMap);
        setFilmAvailMap(availMap);
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

  // When film language map loads/changes, refresh search to honor primary language-only semantics
  useEffect(() => {
    // only rerun if we already have results or query has content to avoid extra initial flicker
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmLangMap, preferences.main_language]);

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
      <aside className="col-span-12 md:col-span-3 space-y-4">
        {/* Film facet based on current results */}
        <div className="pixel-filter-panel">
          <h5>Films</h5>
          <button
            className={`pixel-filter-btn ${filmFilter===null? 'active':''}`}
            onClick={() => setFilmFilter(null)}
          >
            {(() => {
              const count = allResults.length;
              return (
                <>
                  All <span className="opacity-70">({count})</span>
                </>
              );
            })()}
          </button>
          <div className="mt-2 max-h-[60vh] overflow-auto pr-1 space-y-1">
            {films.map((id) => {
              const count = allResults.reduce(
                (n, c) => n + (c.film_id === id ? 1 : 0),
                0
              );
              return (
                <button
                  key={id}
                  className={`pixel-filter-btn ${filmFilter===id? 'active':''}`}
                  onClick={() => {
                    setFilmFilter(id);
                  }}
                  title={id}
                >
                  {filmTitleMap[id] || id}
                  <span className="float-right opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

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
