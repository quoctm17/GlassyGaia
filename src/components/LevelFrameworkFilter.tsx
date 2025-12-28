import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Flame } from 'lucide-react';
import CustomSelect from './CustomSelect';
import '../styles/components/difficulty-filter.css';

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

function LevelFrameworkFilter({ mainLanguage, minLevel, maxLevel, onLevelChange }: LevelFrameworkFilterProps) {
  const framework = useMemo(() => FRAMEWORKS[mainLanguage] || FRAMEWORKS.en, [mainLanguage]);
  const levels = framework.levels;
  
  const [localMin, setLocalMin] = useState<string | null>(minLevel || levels[0]);
  const [localMax, setLocalMax] = useState<string | null>(maxLevel || levels[levels.length - 1]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);
  const prevMainLanguageRef = useRef<string>(mainLanguage);

  // Reset to framework defaults when language changes (only if language actually changed)
  useEffect(() => {
    if (prevMainLanguageRef.current !== mainLanguage) {
      prevMainLanguageRef.current = mainLanguage;
      const newMin = levels[0];
      const newMax = levels[levels.length - 1];
      setLocalMin(newMin);
      setLocalMax(newMax);
      // Only call onLevelChange if values actually changed to avoid unnecessary API calls
      // Check for null values properly
      const currentMin = minLevel ?? levels[0];
      const currentMax = maxLevel ?? levels[levels.length - 1];
      if (currentMin !== newMin || currentMax !== newMax) {
        onLevelChange(newMin, newMax);
      }
    }
  }, [mainLanguage, levels, minLevel, maxLevel, onLevelChange]);

  // Sync with parent when parent changes externally (only if different from local state)
  useEffect(() => {
    if (minLevel !== null && minLevel !== localMin) {
      setLocalMin(minLevel);
    }
    if (maxLevel !== null && maxLevel !== localMax) {
      setLocalMax(maxLevel);
    }
  }, [minLevel, maxLevel, localMin, localMax]);

  // Debounced update to parent (reduced from 500ms to 300ms for faster response)
  const debouncedUpdate = useCallback((min: string, max: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onLevelChange(min, max);
    }, 300);
  }, [onLevelChange]);

  // Memoize getIndex to avoid recalculation
  const getIndex = useCallback((level: string | null): number => {
    if (!level) return 0;
    const idx = levels.indexOf(level);
    return idx >= 0 ? idx : 0;
  }, [levels]);

  const handleMinChange = useCallback((value: string) => {
    const minIdx = getIndex(value);
    const maxIdx = getIndex(localMax);
    if (minIdx > maxIdx) return; // Min must be <= Max
    setLocalMin(value);
    debouncedUpdate(value, localMax || levels[levels.length - 1]);
  }, [localMax, levels, getIndex, debouncedUpdate]);

  const handleMaxChange = useCallback((value: string) => {
    const minIdx = getIndex(localMin);
    const maxIdx = getIndex(value);
    if (maxIdx < minIdx) return; // Max must be >= Min
    setLocalMax(value);
    debouncedUpdate(localMin || levels[0], value);
  }, [localMin, levels, getIndex, debouncedUpdate]);

  const handleSliderMove = useCallback((clientX: number, handle: 'min' | 'max') => {
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
  }, [levels, handleMinChange, handleMaxChange]);

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
  }, [dragging, levels, localMin, localMax, getIndex, handleSliderMove]);

  // Memoize computed values to avoid recalculation on every render
  const minIdx = useMemo(() => getIndex(localMin), [localMin, getIndex]);
  const maxIdx = useMemo(() => getIndex(localMax), [localMax, getIndex]);
  const minPercent = useMemo(() => (minIdx / (levels.length - 1)) * 100, [minIdx, levels.length]);
  const maxPercent = useMemo(() => (maxIdx / (levels.length - 1)) * 100, [maxIdx, levels.length]);

  // Memoize dropdown options to prevent unnecessary re-renders
  const minOptions = useMemo(() => levels.slice(0, maxIdx + 1).map(lvl => ({ value: lvl, label: lvl })), [levels, maxIdx]);
  const maxOptions = useMemo(() => levels.slice(minIdx).map(lvl => ({ value: lvl, label: lvl })), [levels, minIdx]);

  return (
    <div className="difficulty-block">
      {/* Dropdown selectors */}
      <div className="difficulty-range-row">
        <div className="difficulty-input">
          <label className="diff-label">MIN</label>
          <CustomSelect
            value={localMin || levels[0]}
            onChange={handleMinChange}
            options={minOptions}
            className="level-dropdown-trigger"
          />
        </div>
        <div className="difficulty-input">
          <label className="diff-label">MAX</label>
          <CustomSelect
            value={localMax || levels[levels.length - 1]}
            onChange={handleMaxChange}
            options={maxOptions}
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

export default memo(LevelFrameworkFilter);
