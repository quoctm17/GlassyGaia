
import { useEffect, useRef } from 'react';
import type { CardDoc, LevelFrameworkStats } from '../types';
import ContentSelector from './ContentSelector';
import '../styles/components/filter-panel.css';

interface FilterPanelProps {
  filmTitleMap: Record<string, string>;
  filmTypeMap: Record<string, string | undefined>;
  filmLangMap: Record<string, string>;
  filmStatsMap: Record<string, LevelFrameworkStats | null>;
  allResults: CardDoc[]; // results already filtered by query (not difficulty yet)
  contentCounts?: Record<string, number>; // server-side counts across full result set
  totalCount?: number; // server-side total across all contents
  allContentIds?: string[]; // ALL available content IDs
  filmFilter: string[];
  onSelectFilm: (filmIds: string[]) => void;
  mainLanguage: string;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function FilterPanel({ 
  filmTitleMap, 
  filmTypeMap, 
  filmLangMap, 
  filmStatsMap,
  allResults, 
  contentCounts, 
  totalCount, 
  allContentIds,
  filmFilter, 
  onSelectFilm, 
  mainLanguage,
  isOpen = true,
  onClose
}: FilterPanelProps) {
  const prevMainLanguageRef = useRef<string | null>(null);

  // Khi mainLanguage thay đổi, reset selection trong ContentSelector
  useEffect(() => {
    if (prevMainLanguageRef.current && prevMainLanguageRef.current !== mainLanguage) {
      onSelectFilm([]);
    }
    prevMainLanguageRef.current = mainLanguage;
  }, [mainLanguage, onSelectFilm]);

  return (
    <>
      <div className={`filter-panel-wrapper ${isOpen ? 'open' : ''}`}>
        {onClose && (
          <button
            className="filter-panel-close-btn"
            onClick={onClose}
            aria-label="Close filter panel"
          >
            ✕
          </button>
        )}
        <ContentSelector
          value={filmFilter}
          onChange={onSelectFilm}
          allResults={allResults}
          contentCounts={contentCounts}
          totalCount={totalCount}
          allContentIds={allContentIds}
          filmTypeMapExternal={filmTypeMap}
          filmTitleMapExternal={filmTitleMap}
          filmLangMapExternal={filmLangMap}
          filmStatsMapExternal={filmStatsMap}
          mainLanguage={mainLanguage}
        />
      </div>
    </>
  );
}
