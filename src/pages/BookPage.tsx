import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listContentByType } from "../services/firestore";
import { apiGetFilm } from "../services/cfApi";
import type { FilmDoc } from "../types";
import { canonicalizeLangCode } from "../utils/lang";
import LanguageTag from "../components/LanguageTag";

export default function BookPage() {
  const [items, setItems] = useState<FilmDoc[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const base = await listContentByType('book');
        const detailed = await Promise.all(base.map(async (f) => {
          const d = await apiGetFilm(f.id).catch(() => null);
          return d ? { ...f, ...d } : f;
        }));
        setItems(detailed);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Book</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((f) => {
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
                <div className="text-[11px] text-gray-400 flex justify-between items-center">
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
