import { useEffect } from 'react';
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

export default function FilterModal({
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
  
  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

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
            <LevelFrameworkFilter
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
            <DifficultyFilter
              minDifficulty={minDifficulty}
              maxDifficulty={maxDifficulty}
              onDifficultyChange={onDifficultyChange}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn modal-btn-clear" onClick={() => {
            onDifficultyChange(0, 100);
            onLevelChange(null, null);
          }}>
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
