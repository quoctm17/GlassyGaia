import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import EpisodeSelector from "../components/EpisodeSelector";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";
import { fetchCardsForFilm, searchCardsClient, getFilmDoc } from "../services/firestore";
import SearchBar from "../components/SearchBar";

export default function ContentCardsPage() {
  const { contentId = "" } = useParams();
  const [episodeId, setEpisodeId] = useState("e1");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [primaryLang, setPrimaryLang] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!contentId) return;
    getFilmDoc(contentId).then((f) => setPrimaryLang(f?.main_language));
  }, [contentId]);

  useEffect(() => {
    if (!contentId) return;
    setLoading(true);
    if (query.trim()) {
      searchCardsClient(contentId, query, primaryLang, episodeId)
        .then(setCards)
        .finally(() => setLoading(false));
    } else {
      fetchCardsForFilm(contentId, episodeId, 100)
        .then(setCards)
        .finally(() => setLoading(false));
    }
  }, [contentId, episodeId, query, primaryLang]);

  if (!contentId) return <Navigate to="/search" replace />;

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <aside className="col-span-12 md:col-span-3 space-y-3">
        <div className="bg-gray-800 border border-gray-700 rounded p-3 space-y-3">
          <EpisodeSelector filmId={contentId} value={episodeId} onChange={setEpisodeId} />
        </div>
      </aside>
      <main className="col-span-12 md:col-span-9">
        <SearchBar
          value={query}
          onChange={(v) => setQuery(v)}
          onSearch={(v) => setQuery(v)}
          placeholder={`Search in ${contentId} ${episodeId.toUpperCase()}...`}
          buttonLabel="Search by"
        />
        <div className="mt-4 text-sm text-gray-400">
          {loading ? "Đang tải..." : `Có ${cards.length} cards`}
        </div>
        <div className="mt-4 space-y-3">
          {cards.map((c) => (
            <SearchResultCard key={c.id + c.film_id} card={c} primaryLang={primaryLang} />
          ))}
        </div>
      </main>
    </div>
  );
}
