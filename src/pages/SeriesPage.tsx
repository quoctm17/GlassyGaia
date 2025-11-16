import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { listContentByType } from "../services/firestore";
import { apiGetFilm } from "../services/cfApi";
import type { FilmDoc } from "../types";
import LanguageTag from "../components/LanguageTag";

export default function SeriesPage() {
  const [items, setItems] = useState<FilmDoc[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [overlayStyle, setOverlayStyle] = useState<Record<string, React.CSSProperties>>({});
  const cardRefs = useRef<Record<string, HTMLElement>>({});

  useEffect(() => {
    (async () => {
      try {
        const base = await listContentByType('series');
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
      <h1 className="text-xl font-semibold mb-4">Series</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {items.map((f) => {
          const R2 = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          const cover = f.cover_url || (R2 ? `${R2}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
          const mainCode = f.main_language;
          const isHovered = hoveredId === f.id;

          const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const overlayWidth = Math.min(window.innerWidth * 0.88, 720);
            const viewportWidth = window.innerWidth;
            
            let leftOffset = rect.left + rect.width / 2 - overlayWidth / 2;
            
            if (leftOffset < 16) {
              leftOffset = 16;
            }
            if (leftOffset + overlayWidth > viewportWidth - 16) {
              leftOffset = viewportWidth - overlayWidth - 16;
            }
            
            setOverlayStyle(prev => ({
              ...prev,
              [f.id]: {
                position: 'fixed',
                left: `${leftOffset}px`,
                top: '50%',
                transform: 'translateY(-50%)',
                width: `${overlayWidth}px`,
              }
            }));
            setHoveredId(f.id);
          };

          const handleMouseLeave = () => {
            setHoveredId(null);
          };

          return (
            <Link
              key={f.id}
              to={`/content/${f.id}`}
              ref={(el) => { if (el) cardRefs.current[f.id] = el; }}
              className="block rounded-lg transition-all duration-500 group relative will-change-transform hover:scale-[1.04] hover:shadow-2xl"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              {/* Portrait Image Container */}
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg">
                <img 
                  src={cover} 
                  alt={String(f.title || f.id)} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} 
                />
                {/* Bottom-centered badges: main language (gray) + year (light pink) */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent pb-2 pt-6">
                  <div className="flex justify-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] bg-gray-600/85 text-white">
                      {mainCode ? <LanguageTag code={mainCode} /> : <span>-</span>}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] bg-pink-300/95 text-black font-semibold">
                      {f.release_year ?? "-"}
                    </span>
                  </div>
                </div>
              </div>
              {/* Hover expanded info overlay */}
              {isHovered && (
              <div 
                className="pointer-events-none hidden md:block z-[100] opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-500"
                style={overlayStyle[f.id] || {}}
              >
                <div className="w-[min(88vw,720px)] bg-[#14101b]/95 border border-pink-500 rounded-2xl shadow-[0_0_40px_rgba(236,72,153,0.35)] backdrop-blur-sm overflow-hidden">
                  <div className="relative w-full aspect-video bg-black">
                    <img src={cover} alt={String(f.title || f.id)} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-gray-700/85 text-white">
                          {mainCode ? <LanguageTag code={mainCode} /> : <span>-</span>}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-pink-300/95 text-black font-semibold">
                          {f.release_year ?? "-"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-gray-500/80 text-white">
                          Ep: {f.total_episodes ?? f.episodes ?? '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="font-semibold text-base mb-2 text-white">{f.title || f.id}</div>
                    <div className="text-[12px] text-gray-300">
                      <span className="opacity-80 mr-2">Available Subs:</span>
                      <span className="inline-flex flex-wrap gap-2 align-middle">
                        {(f.available_subs || []).slice(0, 20).map((l) => (
                          <span key={l} className="inline-flex items-center gap-1 bg-gray-700/60 px-2 py-0.5 rounded">
                            <LanguageTag code={l} size="sm" />
                          </span>
                        ))}
                        {(!f.available_subs || f.available_subs.length === 0) && <span className="text-gray-400">-</span>}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Title Below Image, centered */}
              <div className="pt-2 px-2">
                <div className="font-medium text-sm line-clamp-2 min-h-[2.5rem] text-center">{f.title || f.id}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
