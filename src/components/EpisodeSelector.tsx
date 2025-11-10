import { useEffect, useState } from "react";
import { getEpisodeIdsForFilm } from "../services/firestore";

interface Props {
  filmId: string;
  value: string;
  onChange: (episodeId: string) => void;
}

export default function EpisodeSelector({ filmId, value, onChange }: Props) {
  const [episodes, setEpisodes] = useState<string[]>([]);

  useEffect(() => {
    if (!filmId) return;
    getEpisodeIdsForFilm(filmId).then(setEpisodes).catch(() => setEpisodes(["e1"]));
  }, [filmId]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400">Episode</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
      >
        {episodes.map((e) => (
          <option key={e} value={e}>
            {e.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
