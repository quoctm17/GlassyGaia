import { useEffect, useState } from "react";
import { listFilms } from "../services/firestore";
import { apiGetFilm } from "../services/cfApi";
import type { FilmDoc } from "../types";
import { Link } from "react-router-dom";
import { canonicalizeLangCode } from "../utils/lang";
import LanguageTag from "../components/LanguageTag";

export default function ContentMoviePage() {
  const [films, setFilms] = useState<FilmDoc[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const base = await listFilms();
        // Enrich each with detail (cover_url, available_subs, etc.)
        const detailed = await Promise.all(
          base.map(async (f) => {
            const d = await apiGetFilm(f.id).catch(() => null);
            return d ? { ...f, ...d } : f;
          })
        );
        setFilms(detailed);
      } catch {
        setFilms([]);
      }
    })();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Movie</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {films.map((f) => {
          const R2 = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          const cover = f.cover_url || (R2 ? `${R2}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
          const mainCode = f.main_language;
          const mainCanon = mainCode ? (canonicalizeLangCode(mainCode) || mainCode.toLowerCase()) : undefined;
          const langs = Array.from(new Set((f.available_subs || [])
            .map((l) => (canonicalizeLangCode(l) || l.toLowerCase()))
            .filter((l) => l && l !== mainCanon)));
          return (
            <Link key={f.id} to={`/content/${f.id}`} className="block bg-gray-800 border border-gray-700 rounded overflow-hidden hover:border-gray-600">
              <img src={cover} alt={String(f.title || f.id)} className="w-full h-40 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              <div className="p-3 space-y-1">
                <div className="font-medium">{f.title || f.id}</div>
                <div className="text-[11px] text-gray-400 flex gap-3 items-center">
                  <span className="inline-flex items-center gap-1">
                    <span>Main:</span>
                    {mainCode ? <LanguageTag code={mainCode} /> : <span>-</span>}
                  </span>
                  <span>Year: {f.release_year ?? '-'}</span>
                </div>
                <div className="text-[11px] text-gray-400">
                  <span>Subs: </span>
                  {langs.length ? (
                    <span className="inline-flex flex-wrap gap-2 align-middle">
                      {langs.map((l) => (
                        <span key={l} className="inline-flex items-center gap-1 bg-gray-700/60 px-2 py-0.5 rounded text-[10px]">
                          <LanguageTag code={l} size="sm" />
                        </span>
                      ))}
                    </span>
                  ) : (
                    '-'
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
