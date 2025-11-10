import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { listFavorites } from "../services/progress";
import { getCardByPath, listFilms } from "../services/firestore";
import SearchResultCard from "../components/SearchResultCard";
import type { CardDoc } from "../types";

export default function FavoritesPage() {
  const { user, signInGoogle } = useUser();
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [filmLangMap, setFilmLangMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      const favs = await listFavorites(user.uid);
      // Fetch cards; skip entries without film/episode
      const tasks = favs
        .filter((f) => f.film_id && f.episode_id)
        .map((f) => getCardByPath(f.film_id!, f.episode_id!, f.card_id));
      const results = await Promise.all(tasks);
      setCards(results.filter(Boolean) as CardDoc[]);
      setLoading(false);
    };
    load();
  }, [user]);

  useEffect(() => {
    // Build film -> primary language map for primary subtitle highlighting
    listFilms()
      .then((fs) => {
        const map: Record<string, string> = {};
  fs.forEach((f) => { if (f.main_language) map[f.id] = f.main_language; });
        setFilmLangMap(map);
      })
      .catch(() => setFilmLangMap({}));
  }, []);

  if (!user) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-gray-800 border border-gray-700 rounded p-6">
          <div className="text-lg mb-2">Your favorites</div>
          <div className="text-sm text-gray-300 mb-4">Sign in to see cards you've favorited.</div>
          <button className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500" onClick={signInGoogle}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="text-sm text-gray-400 mb-4">{loading ? "Loading..." : `${cards.length} favorite cards`}</div>
      <div className="space-y-3">
        {cards.map((c) => (
          <SearchResultCard key={`${c.film_id}-${c.episode_id}-${c.id}`} card={c} primaryLang={filmLangMap[String(c.film_id ?? '')]} />
        ))}
      </div>
    </div>
  );
}
