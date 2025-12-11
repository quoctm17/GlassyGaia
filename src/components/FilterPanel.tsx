
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
  mainLanguage 
}: FilterPanelProps) {
  return (
    <div className="filter-panel-wrapper">
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
  );
}
