import { useEffect, useState, useMemo, useRef } from 'react';
import { listContentByType } from '../services/firestore';
import { apiGetFilm } from '../services/cfApi';
import type { FilmDoc } from '../types';
import ContentDetailModal from './ContentDetailModal';
import { CONTENT_TYPE_LABELS, type ContentType } from '../types/content';
import { useUser } from '../context/UserContext';
import { canonicalizeLangCode } from '../utils/lang';
import SearchBar from './SearchBar';
import ContentFilterPanel from './ContentFilterPanel';
import PortalDropdown from './PortalDropdown';
import { ArrowUpDown } from 'lucide-react';

interface ContentTypeGridProps {
  type: ContentType; // 'movie' | 'series' | 'book' | 'audio'
  headingOverride?: string; // optional custom heading
  limit?: number; // future: limit number of items
  onlySelectedMainLanguage?: boolean; // filter by user's selected main language
}

export default function ContentTypeGrid({ type, headingOverride, limit, onlySelectedMainLanguage }: ContentTypeGridProps) {
  const [allItems, setAllItems] = useState<FilmDoc[]>([]); // all items from API
  const [selectedFilm, setSelectedFilm] = useState<FilmDoc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { preferences } = useUser();
  const selectedMain = preferences?.main_language || 'en';

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'year' | 'difficulty'>('title');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Sort dropdown state
  const [sortOpen, setSortOpen] = useState(false);
  const [sortClosing, setSortClosing] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement | null>(null);

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
        setAllItems(filtered);
      } catch {
        if (mounted) setAllItems([]);
      }
    })();
    return () => { mounted = false; };
  }, [type, onlySelectedMainLanguage, selectedMain]);

  // Apply search and filters
  const filteredItems = useMemo(() => {
    let result = allItems;

    // Search filter (by title)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => 
        (item.title || '').toLowerCase().includes(q) ||
        (item.id || '').toLowerCase().includes(q)
      );
    }

    // Year filter
    if (selectedYear !== null) {
      result = result.filter(item => String(item.release_year) === selectedYear);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'title') {
        comparison = (a.title || '').localeCompare(b.title || '');
      } else if (sortBy === 'year') {
        comparison = (a.release_year || 0) - (b.release_year || 0);
      } else if (sortBy === 'difficulty') {
        comparison = (a.avg_difficulty_score || 0) - (b.avg_difficulty_score || 0);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply limit if specified
    return limit ? result.slice(0, limit) : result;
  }, [allItems, searchQuery, selectedYear, limit, sortBy, sortOrder]);

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

  const handleSortClose = () => {
    if (!sortClosing) {
      setSortClosing(true);
      setTimeout(() => { setSortOpen(false); setSortClosing(false); }, 200);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">{label}</h1>
      
      {/* Search bar */}
      <div className="mb-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by title..."
          showClear
        />
      </div>

      {/* Filter and Sort controls - same row */}
      <div className="mb-4 flex items-center gap-3">
        <ContentFilterPanel
          items={allItems}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
        />

        {/* Sort Button (same style as Filter) */}
        <button
          ref={sortBtnRef}
          onClick={() => {
            if (sortOpen) {
              handleSortClose();
            } else {
              setSortOpen(true);
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-pink-600/20 hover:bg-pink-600/30 text-pink-400 rounded-lg transition-colors border border-pink-500/50 hover:border-pink-500"
        >
          <ArrowUpDown size={16} className="text-pink-400" />
          <span className="font-medium text-sm">Sort</span>
        </button>

        {(sortOpen || sortClosing) && sortBtnRef.current && (
          <PortalDropdown
            anchorEl={sortBtnRef.current}
            onClose={handleSortClose}
            align="left"
            offset={8}
            className="language-dropdown"
            durationMs={200}
            closing={sortClosing}
            minWidth={220}
          >
            {/* Sort By Section */}
            <div className="language-options-header">Sort By</div>
            <div className="language-options-list border-b border-gray-700/50 pb-2">
              <button
                onClick={() => setSortBy('title')}
                className={`language-option ${sortBy === 'title' ? 'active' : ''}`}
              >
                <span>Title</span>
              </button>
              <button
                onClick={() => setSortBy('year')}
                className={`language-option ${sortBy === 'year' ? 'active' : ''}`}
              >
                <span>Release Year</span>
              </button>
              <button
                onClick={() => setSortBy('difficulty')}
                className={`language-option ${sortBy === 'difficulty' ? 'active' : ''}`}
              >
                <span>Difficulty</span>
              </button>
            </div>

            {/* Sort Order Section */}
            <div className="language-options-header mt-2">Order</div>
            <div className="language-options-list">
              <button
                onClick={() => setSortOrder('asc')}
                className={`language-option ${sortOrder === 'asc' ? 'active' : ''}`}
              >
                <span>↑ Ascending</span>
              </button>
              <button
                onClick={() => setSortOrder('desc')}
                className={`language-option ${sortOrder === 'desc' ? 'active' : ''}`}
              >
                <span>↓ Descending</span>
              </button>
            </div>
          </PortalDropdown>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filteredItems.map(f => {
          const cover = f.cover_url || (R2Base ? `${R2Base}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
          return (
            <div
              key={f.id}
              className="group relative rounded-lg transition-all duration-300 cursor-pointer border border-transparent hover:border-pink-500 hover:shadow-[0_0_0_2px_rgba(236,72,153,0.85),0_0_14px_rgba(236,72,153,0.55)] hover:bg-black/30"
              style={{ pointerEvents: modalOpen ? 'none' : 'auto' }}
              onClick={() => openModal(f)}
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-black/40 flex items-center justify-center">
                {cover && (
                  <img
                    src={cover}
                    alt={String(f.title || f.id)}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
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
