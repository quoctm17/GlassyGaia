import { useEffect, useState } from 'react';
import { listContentByType } from '../services/firestore';
import { apiGetFilm } from '../services/cfApi';
import type { FilmDoc } from '../types';
import ContentDetailModal from './ContentDetailModal';
import { CONTENT_TYPE_LABELS, type ContentType } from '../types/content';
import { useUser } from '../context/UserContext';
import { canonicalizeLangCode } from '../utils/lang';

interface ContentTypeGridProps {
  type: ContentType; // 'movie' | 'series' | 'book' | 'audio'
  headingOverride?: string; // optional custom heading
  limit?: number; // future: limit number of items
  onlySelectedMainLanguage?: boolean; // filter by user's selected main language
}

export default function ContentTypeGrid({ type, headingOverride, limit, onlySelectedMainLanguage }: ContentTypeGridProps) {
  const [items, setItems] = useState<FilmDoc[]>([]);
  const [selectedFilm, setSelectedFilm] = useState<FilmDoc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { preferences } = useUser();
  const selectedMain = preferences?.main_language || 'en';

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
        const canonSelected = canonicalizeLangCode(selectedMain) || selectedMain;
        const filtered = onlySelectedMainLanguage
          ? detailed.filter((f) => {
              const canon = canonicalizeLangCode(f.main_language || '');
              return !!f.main_language && (canon || f.main_language) === canonSelected;
            })
          : detailed;
        setItems(limit ? filtered.slice(0, limit) : filtered);
      } catch {
        if (mounted) setItems([]);
      }
    })();
    return () => { mounted = false; };
  }, [type, limit, onlySelectedMainLanguage, selectedMain]);

  const openModal = (f: FilmDoc) => {
    setSelectedFilm(f);
    window.setTimeout(() => setModalOpen(true), 0);
  };
  const closeModal = () => {
    setModalOpen(false);
    window.setTimeout(() => setSelectedFilm(null), 500);
  };

  const label = headingOverride || CONTENT_TYPE_LABELS[type] || type;
  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">{label}</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {items.map(f => {
          const cover = f.cover_url || (R2Base ? `${R2Base}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
          return (
            <div
              key={f.id}
              className="group relative rounded-lg transition-all duration-300 cursor-pointer border border-transparent hover:border-pink-500 hover:shadow-[0_0_0_2px_rgba(236,72,153,0.85),0_0_14px_rgba(236,72,153,0.55)] hover:bg-black/30"
              style={{ pointerEvents: modalOpen ? 'none' : 'auto' }}
              onClick={() => openModal(f)}
            >
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black/40 flex items-center justify-center">
                {cover && (
                  <img
                    src={cover}
                    alt={String(f.title || f.id)}
                    className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="pt-2 px-1">
                <div className="font-medium text-xs text-center text-gray-200 whitespace-normal break-words">{f.title || f.id}</div>
              </div>
            </div>
          );
        })}
      </div>
      <ContentDetailModal film={selectedFilm} open={modalOpen} onClose={closeModal} />
    </div>
  );
}
