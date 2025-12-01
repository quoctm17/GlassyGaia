import { useState, useEffect, useRef } from 'react';
import { Flame } from 'lucide-react';
import CustomSelect from './CustomSelect';

interface LevelFrameworkFilterProps {
  mainLanguage: string;
  minLevel: string | null;
  maxLevel: string | null;
  onLevelChange: (min: string | null, max: string | null) => void;
}

// Framework definitions
const FRAMEWORKS: Record<string, { name: string; levels: string[] }> = {
  en: {
    name: 'CEFR LEVEL',
    levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
  },
  ja: {
    name: 'JLPT LEVEL',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1']
  },
  zh: {
    name: 'HSK LEVEL',
    levels: ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  }
};

export default function LevelFrameworkFilter({ mainLanguage, minLevel, maxLevel, onLevelChange }: LevelFrameworkFilterProps) {
  const framework = FRAMEWORKS[mainLanguage] || FRAMEWORKS.en;
  const levels = framework.levels;
  
  const [localMin, setLocalMin] = useState<string | null>(minLevel || levels[0]);
  const [localMax, setLocalMax] = useState<string | null>(maxLevel || levels[levels.length - 1]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);

  // Reset to framework defaults when language changes
  useEffect(() => {
    setLocalMin(levels[0]);
    setLocalMax(levels[levels.length - 1]);
    onLevelChange(levels[0], levels[levels.length - 1]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainLanguage]);

  // Sync with parent when parent changes externally
  useEffect(() => {
    if (minLevel !== null) setLocalMin(minLevel);
    if (maxLevel !== null) setLocalMax(maxLevel);
  }, [minLevel, maxLevel]);

  // Debounced update to parent (500ms)
  const debouncedUpdate = (min: string, max: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onLevelChange(min, max);
    }, 500);
  };

  const getIndex = (level: string | null): number => {
    if (!level) return 0;
    const idx = levels.indexOf(level);
    return idx >= 0 ? idx : 0;
  };

  const handleMinChange = (value: string) => {
    const minIdx = getIndex(value);
    const maxIdx = getIndex(localMax);
    if (minIdx > maxIdx) return; // Min must be <= Max
    setLocalMin(value);
    debouncedUpdate(value, localMax || levels[levels.length - 1]);
  };

  const handleMaxChange = (value: string) => {
    const minIdx = getIndex(localMin);
    const maxIdx = getIndex(value);
    if (maxIdx < minIdx) return; // Max must be >= Min
    setLocalMax(value);
    debouncedUpdate(localMin || levels[0], value);
  };

  const handleSliderMove = (clientX: number, handle: 'min' | 'max') => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    const index = Math.max(0, Math.min(levels.length - 1, Math.round((percent / 100) * (levels.length - 1))));
    const value = levels[index];
    
    if (handle === 'min') {
      handleMinChange(value);
    } else {
      handleMaxChange(value);
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || dragging) return;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    const index = Math.round((percent / 100) * (levels.length - 1));
    
    // Click closer to min or max handle
    const minIdx = getIndex(localMin);
    const maxIdx = getIndex(localMax);
    const distToMin = Math.abs(index - minIdx);
    const distToMax = Math.abs(index - maxIdx);
    
    if (distToMin < distToMax) {
      handleSliderMove(e.clientX, 'min');
    } else {
      handleSliderMove(e.clientX, 'max');
    }
  };

  const minIdx = getIndex(localMin);
  const maxIdx = getIndex(localMax);
  const minPercent = (minIdx / (levels.length - 1)) * 100;
  const maxPercent = (maxIdx / (levels.length - 1)) * 100;

  // Get available options for dropdowns
  const minOptions = levels.slice(0, maxIdx + 1);
  const maxOptions = levels.slice(minIdx);

  return (
    <div className="difficulty-block">
      <div className="difficulty-title">{framework.name}</div>
      
      {/* Dropdown selectors */}
      <div className="difficulty-range-row">
        <div className="difficulty-input">
          <label className="diff-label">MIN</label>
          <CustomSelect
            value={localMin || levels[0]}
            onChange={handleMinChange}
            options={minOptions.map(lvl => ({ value: lvl, label: lvl }))}
            className="level-dropdown-trigger"
          />
        </div>
        <div className="difficulty-input">
          <label className="diff-label">MAX</label>
          <CustomSelect
            value={localMax || levels[levels.length - 1]}
            onChange={handleMaxChange}
            options={maxOptions.map(lvl => ({ value: lvl, label: lvl }))}
            className="level-dropdown-trigger"
          />
        </div>
      </div>

      {/* Dual-handle slider with flame icons */}
      <div className="difficulty-slider-container">
        <div 
          ref={trackRef}
          className="difficulty-track"
          onClick={handleTrackClick}
        >
          {/* Level tick marks */}
          {levels.map((_, idx) => {
            const tickPercent = (idx / (levels.length - 1)) * 100;
            return (
              <div
                key={idx}
                className="level-tick-mark"
                style={{ left: `${tickPercent}%` }}
                title={levels[idx]}
              />
            );
          })}
          
          {/* Active range highlight */}
          <div 
            className="difficulty-track-active"
            style={{
              left: `${minPercent}%`,
              width: `${maxPercent - minPercent}%`
            }}
          />
          
          {/* Min handle */}
          <div
            className="difficulty-handle"
            style={{ left: `${minPercent}%` }}
            onMouseDown={() => setDragging('min')}
            onTouchStart={(e) => {
              e.preventDefault();
              setDragging('min');
            }}
          >
            <Flame className="w-4 h-4 text-pink-400" fill="currentColor" />
          </div>
          
          {/* Max handle */}
          <div
            className="difficulty-handle"
            style={{ left: `${maxPercent}%` }}
            onMouseDown={() => setDragging('max')}
            onTouchStart={(e) => {
              e.preventDefault();
              setDragging('max');
            }}
          >
            <Flame className="w-4 h-4 text-pink-400" fill="currentColor" />
          </div>
        </div>
      </div>

      {/* Mouse and touch tracking for drag */}
      {dragging && (
        <div
          className="fixed inset-0 z-50 cursor-grabbing"
          onMouseMove={(e) => {
            handleSliderMove(e.clientX, dragging);
          }}
          onMouseUp={() => setDragging(null)}
          onTouchMove={(e) => {
            const touch = e.touches[0];
            handleSliderMove(touch.clientX, dragging);
          }}
          onTouchEnd={() => setDragging(null)}
        />
      )}
    </div>
  );
}
