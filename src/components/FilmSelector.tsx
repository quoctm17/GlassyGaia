import { useEffect, useState } from "react";
import { listFilms } from "../services/firestore";
import type { FilmDoc } from "../types";

interface Props {
  value: string | null;
  onChange: (filmId: string) => void;
}

export default function FilmSelector({ value, onChange }: Props) {
  const [films, setFilms] = useState<FilmDoc[]>([]);

  useEffect(() => {
    listFilms().then(setFilms).catch(() => setFilms([]));
  }, []);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-pink-200 uppercase tracking-wide">Film</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="pixel-select min-w-[160px]"
        aria-label="Select film"
      >
        {films.length === 0 && <option value="">No films</option>}
        {films.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id}
          </option>
        ))}
      </select>
    </div>
  );
}
