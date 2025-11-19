import React, { useEffect, useRef, useState } from 'react';
import { listContentByType } from '../services/firestore';
import { apiGetFilm } from '../services/cfApi';
import type { FilmDoc } from '../types';
import LanguageTag from './LanguageTag';
import ContentDetailModal from './ContentDetailModal';
import { Play, ChevronDown, Film, Clapperboard, Book as BookIcon, AudioLines } from 'lucide-react';
import { CONTENT_TYPE_LABELS, type ContentType } from '../types/content';

interface ContentTypeGridProps {
  type: ContentType; // 'movie' | 'series' | 'book' | 'audio'
  headingOverride?: string; // optional custom heading
  limit?: number; // future: limit number of items
}

export default function ContentTypeGrid({ type, headingOverride, limit }: ContentTypeGridProps) {
  const [items, setItems] = useState<FilmDoc[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedFilm, setSelectedFilm] = useState<FilmDoc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [overlayStyle, setOverlayStyle] = useState<Record<string, React.CSSProperties>>({});
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const base = await listContentByType(type);
        const detailed = await Promise.all(base.map(async (f) => {
          const d = await apiGetFilm(f.id).catch(() => null);
          return d ? { ...f, ...d } : f;
        }));
        if (!mounted) return;
        setItems(limit ? detailed.slice(0, limit) : detailed);
      } catch {
        if (mounted) setItems([]);
      }
    })();
    return () => { mounted = false; };
  }, [type, limit]);

  function computeOverlayPosition(rect: DOMRect, overlayWidth: number) {
    const viewportWidth = window.innerWidth;
    let left = rect.left + rect.width / 2 - overlayWidth / 2;
    if (left < 16) left = 16;
    if (left + overlayWidth > viewportWidth - 16) left = viewportWidth - overlayWidth - 16;
    return left;
  }

  const onEnter = (f: FilmDoc, e?: React.MouseEvent<HTMLElement>) => {
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const overlayWidth = Math.min(window.innerWidth * 0.75, 480);
      const left = computeOverlayPosition(rect, overlayWidth);
      const top = Math.max(16, rect.top - 12);
      setOverlayStyle(prev => ({
        ...prev,
        [f.id]: {
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          width: `${overlayWidth}px`,
          zIndex: 100,
        }
      }));
    }
    setHoveredId(f.id);
  };
  const clearHide = () => { if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const scheduleHide = () => {
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      setHoveredId(null);
    }, 180);
  };
  const onLeave = () => scheduleHide();
  const openModal = (f: FilmDoc) => { 
    clearHide();
    setHoveredId(null);
    setSelectedFilm(f);
    window.setTimeout(() => setModalOpen(true), 0); // allow mount, then animate open
  };
  const closeModal = () => { 
    setModalOpen(false);
    window.setTimeout(() => setSelectedFilm(null), 500); // wait for closing animation
  };

  const label = headingOverride || CONTENT_TYPE_LABELS[type] || type;
  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">{label}</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {items.map(f => {
          const cover = f.cover_url || (R2Base ? `${R2Base}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
          const isHovered = hoveredId === f.id;
          return (
            <div
              key={f.id}
              className="group relative rounded-lg transition-all duration-500 will-change-transform hover:scale-[1.05] hover:shadow-2xl cursor-pointer"
              onMouseEnter={(e) => onEnter(f, e)}
              onMouseLeave={onLeave}
              onClick={() => openModal(f)}
            >
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black/40 flex items-center justify-center">
                {cover && (
                  <img
                    src={cover}
                    alt={String(f.title || f.id)}
                    className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                {isHovered && (
                  <div className="absolute inset-0 z-10" onClick={() => openModal(f)}>
                    {/* Overlay clickable area for modal opening */}
                  </div>
                )}
              </div>
              <div className="pt-2 px-1">
                <div className="font-medium text-xs text-center text-gray-200 whitespace-normal break-words">{f.title || f.id}</div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Hover expanded poster + info card */}
      {items.map(f => {
        const cover = f.cover_url || (R2Base ? `${R2Base}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
        const typeLabel = (() => { const t = f.type as ContentType | undefined; return (t && CONTENT_TYPE_LABELS[t]) || f.type || 'Content'; })();
        const TypeIcon = f.type === 'movie' ? Film : f.type === 'series' ? Clapperboard : f.type === 'book' ? BookIcon : f.type === 'audio' ? AudioLines : null;
        const isActive = hoveredId === f.id;
        return (
          <div
            key={`hover-${f.id}`}
            style={{
              ...overlayStyle[f.id],
              opacity: isActive ? 1 : 0,
              transform: isActive ? 'scale(1)' : 'scale(0.95)',
              pointerEvents: isActive ? 'auto' : 'none',
            }}
            className="hidden md:block transition-all duration-500 ease-out cursor-pointer"
            onMouseEnter={() => { clearHide(); setHoveredId(f.id); }}
            onMouseLeave={() => { scheduleHide(); }}
            onClick={() => openModal(f)}
          >
            <div className="bg-[#14101b]/95 border border-pink-500 rounded-2xl shadow-[0_0_40px_rgba(236,72,153,0.35)] backdrop-blur-sm overflow-hidden transition-all duration-500">
              <div className="relative w-full aspect-video bg-black">
                {cover && <img src={cover} alt={String(f.title || f.id)} className="w-full h-full object-contain" />}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    className="w-9 h-9 rounded-full bg-pink-600 hover:bg-pink-500 text-white flex items-center justify-center transition-colors"
                    onClick={(e) => { e.stopPropagation(); alert('Watch: TODO'); }}
                    aria-label="Watch"
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="w-9 h-9 rounded-full border border-gray-400/60 text-gray-200 hover:bg-white/10 flex items-center justify-center transition-colors"
                    onClick={(e) => { e.stopPropagation(); openModal(f); }}
                    aria-label="More"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                <div className="font-semibold text-base text-white mb-2 leading-snug">{f.title || f.id}</div>
                <div className="flex items-center gap-2 text-[13px] text-white">
                  <span className="flex items-center gap-1.5 px-2 py-1 border border-gray-400/50 rounded-md">
                    {TypeIcon && <TypeIcon className="w-3.5 h-3.5" />}
                    <span>{typeLabel}</span>
                  </span>
                  {f.main_language && (
                    <span className="flex items-center gap-1 px-2 py-1 border border-gray-400/50 rounded-md">
                      <LanguageTag code={f.main_language} size="sm" />
                    </span>
                  )}
                  <span className="px-2 py-1 border border-gray-400/50 rounded-md">
                    {f.release_year || 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <ContentDetailModal film={selectedFilm} open={modalOpen} onClose={closeModal} />
    </div>
  );
}
