import { useEffect, useState } from "react";
import { listFilms } from "../services/firestore";
import type { FilmDoc } from "../types";
import { Link } from "react-router-dom";

export default function MoviePage() {
  const [films, setFilms] = useState<FilmDoc[]>([]);
  useEffect(() => {
    listFilms().then(setFilms).catch(() => setFilms([]));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Movie</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {films.map((f) => (
          <Link key={f.id} to={`/movie/${f.id}`} className="block bg-gray-800 border border-gray-700 rounded overflow-hidden hover:border-gray-600">
            {f.cover_url && (
              <img src={f.cover_url} alt={f.id} className="w-full h-40 object-cover" />
            )}
            <div className="p-3">
              <div className="font-medium">{f.title || f.id}</div>
              <div className="text-xs text-gray-400 mt-1">Subs: {(f.available_subs || []).join(", ")}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
