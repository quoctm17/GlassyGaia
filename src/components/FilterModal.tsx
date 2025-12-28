import { useEffect, memo, useCallback } from 'react';
import DifficultyFilter from './DifficultyFilter';
import LevelFrameworkFilter from './LevelFrameworkFilter';
import filterIcon from '../assets/icons/filter.svg';
import '../styles/components/filter-modal.css';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  minDifficulty: number;
  maxDifficulty: number;
  onDifficultyChange: (min: number, max: number) => void;
  minLevel: string | null;
  maxLevel: string | null;
  onLevelChange: (min: string | null, max: string | null) => void;
  mainLanguage: string;
}

// Memoized filter components to prevent unnecessary re-renders
const MemoizedDifficultyFilter = memo(DifficultyFilter);
const MemoizedLevelFrameworkFilter = memo(LevelFrameworkFilter);

function FilterModal({
  isOpen,
  onClose,
  minDifficulty,
  maxDifficulty,
  onDifficultyChange,
  minLevel,
  maxLevel,
  onLevelChange,
  mainLanguage
}: FilterModalProps) {
  
  // Optimize ESC key handler: only add listener when modal is open
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Memoize clear handler to prevent re-renders
  const handleClear = useCallback(() => {
    onDifficultyChange(0, 100);
    onLevelChange(null, null);
  }, [onDifficultyChange, onLevelChange]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container filter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="filter-modal-title">
            <img src={filterIcon} alt="Filter" className="modal-icon" style={{ filter: 'var(--icon-hover-select-filter)' }} />
            <span>FILTERS</span>
          </div>
          <button className="filter-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className="modal-body">
          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-icon">⭐</span>
              <span className="filter-section-title">LEVEL</span>
            </div>
            <MemoizedLevelFrameworkFilter
              mainLanguage={mainLanguage}
              minLevel={minLevel}
              maxLevel={maxLevel}
              onLevelChange={onLevelChange}
            />
          </div>

          <div className="filter-divider"></div>

          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-icon">🧠</span>
              <span className="filter-section-title">DIFFICULTY SCORE</span>
            </div>
            <MemoizedDifficultyFilter
              minDifficulty={minDifficulty}
              maxDifficulty={maxDifficulty}
              onDifficultyChange={onDifficultyChange}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn modal-btn-clear" onClick={handleClear}>
            CLEAR
          </button>
          <button className="modal-btn modal-btn-apply" onClick={onClose}>
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(FilterModal);
