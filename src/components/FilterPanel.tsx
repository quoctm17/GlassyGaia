
import type { CardDoc } from '../types';
import ContentSelector from './ContentSelector';
import DifficultyFilter from './DifficultyFilter';

interface FilterPanelProps {
  filmTitleMap: Record<string, string>;
  filmTypeMap: Record<string, string | undefined>;
  filmLangMap: Record<string, string>;
  allResults: CardDoc[]; // results already filtered by query (not difficulty yet)
  contentCounts?: Record<string, number>; // server-side counts across full result set
  totalCount?: number; // server-side total across all contents
  filmFilter: string | null;
  onSelectFilm: (filmId: string | null) => void;
  minDifficulty: number;
  maxDifficulty: number;
  onDifficultyChange: (min: number, max: number) => void;
  mainLanguage: string;
}

export default function FilterPanel({ filmTitleMap, filmTypeMap, filmLangMap, allResults, contentCounts, totalCount, filmFilter, onSelectFilm, minDifficulty, maxDifficulty, onDifficultyChange, mainLanguage }: FilterPanelProps) {
  return (
    <div className="filter-panel-wrapper">
      <DifficultyFilter
        minDifficulty={minDifficulty}
        maxDifficulty={maxDifficulty}
        onDifficultyChange={onDifficultyChange}
      />
      <ContentSelector
        value={filmFilter}
        onChange={onSelectFilm}
        allResults={allResults}
        contentCounts={contentCounts}
        totalCount={totalCount}
        filmTypeMapExternal={filmTypeMap}
        filmTitleMapExternal={filmTitleMap}
        filmLangMapExternal={filmLangMap}
        mainLanguage={mainLanguage}
      />
    </div>
  );
}
