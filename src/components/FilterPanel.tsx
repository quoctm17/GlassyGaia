
import type { CardDoc } from '../types';
import ContentSelector from './ContentSelector';

interface FilterPanelProps {
  filmTitleMap: Record<string, string>;
  filmTypeMap: Record<string, string | undefined>;
  allResults: CardDoc[]; // results already filtered by query (not difficulty yet)
  filmFilter: string | null;
  onSelectFilm: (filmId: string | null) => void;
  minDifficulty: number;
  maxDifficulty: number;
  onDifficultyChange: (min: number, max: number) => void;
}

export default function FilterPanel({ filmTitleMap, filmTypeMap, allResults, filmFilter, onSelectFilm, minDifficulty, maxDifficulty, onDifficultyChange }: FilterPanelProps) {
  const handleMin = (v: number) => {
    const clamped = Math.max(0, Math.min(v, maxDifficulty));
    onDifficultyChange(clamped, maxDifficulty);
  };
  const handleMax = (v: number) => {
    const clamped = Math.min(100, Math.max(v, minDifficulty));
    onDifficultyChange(minDifficulty, clamped);
  };

  return (
    <div className="filter-panel-wrapper">
      <div className="difficulty-block">
        <div className="difficulty-title">DIFFICULT SCORE</div>
        <div className="difficulty-range-row">
          <div className="difficulty-input">
            <label className="diff-label">MIN</label>
            <input
              type="number"
              min={0}
              max={100}
              value={minDifficulty}
              onChange={e => handleMin(Number(e.target.value))}
            />
          </div>
          <div className="difficulty-input">
            <label className="diff-label">MAX</label>
            <input
              type="number"
              min={0}
              max={100}
              value={maxDifficulty}
              onChange={e => handleMax(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="difficulty-slider-row">
          <input
            type="range"
            min={0}
            max={100}
            value={minDifficulty}
            onChange={e => handleMin(Number(e.target.value))}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={maxDifficulty}
            onChange={e => handleMax(Number(e.target.value))}
          />
        </div>
      </div>
      <ContentSelector
        value={filmFilter}
        onChange={onSelectFilm}
        allResults={allResults}
        filmTypeMapExternal={filmTypeMap}
        filmTitleMapExternal={filmTitleMap}
      />
    </div>
  );
}
