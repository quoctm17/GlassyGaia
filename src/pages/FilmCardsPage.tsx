import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import EpisodeSelector from "../components/EpisodeSelector";
// Removed old LanguageSelector (replaced by MainLanguageSelector & SubtitleLanguageSelector on NavBar)
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";
import {
  fetchCardsForFilm,
  searchCardsClient,
  getFilmDoc,
} from "../services/firestore";
import SearchBar from "../components/SearchBar";

export default function FilmCardsPage() {
  const { filmId = "" } = useParams();
  const [episodeId, setEpisodeId] = useState("e1");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [primaryLang, setPrimaryLang] = useState<string | undefined>(undefined);
  const [filmTitle, setFilmTitle] = useState<string | undefined>(undefined);
  // Subtitle language selection moved to NavBar; available subs no longer needed here

  useEffect(() => {
    if (!filmId) return;
    getFilmDoc(filmId).then((f) => {
      setPrimaryLang(f?.main_language);
      setFilmTitle(f?.title || filmId);
    });
  }, [filmId]);

  useEffect(() => {
    if (!filmId) return;
    setLoading(true);
    if (query.trim()) {
      searchCardsClient(filmId, query, primaryLang, episodeId)
        .then(setCards)
        .finally(() => setLoading(false));
    } else {
      fetchCardsForFilm(filmId, episodeId, 100)
        .then(setCards)
        .finally(() => setLoading(false));
    }
  }, [filmId, episodeId, query, primaryLang]);

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <aside className="col-span-12 md:col-span-3 space-y-3">
        <div className="bg-gray-800 border border-gray-700 rounded p-3 space-y-3">
          <EpisodeSelector
            filmId={filmId}
            value={episodeId}
            onChange={setEpisodeId}
          />
        </div>
      </aside>
      <main className="col-span-12 md:col-span-9">
        <SearchBar
          value={query}
          onChange={(v) => setQuery(v)}
          onSearch={(v) => setQuery(v)}
          placeholder={`Search in ${filmId} ${episodeId.toUpperCase()}...`}
        />
        {/* Subtitle language selection moved to NavBar */}
        <div className="mt-4 text-sm text-gray-400">
          {loading ? "Đang tải..." : `Có ${cards.length} cards`}
        </div>
        <div className="mt-4 space-y-3">
          {cards.map((c) => (
            <SearchResultCard
              key={c.id + c.film_id}
              card={c}
              primaryLang={primaryLang}
              filmTitle={filmTitle}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
