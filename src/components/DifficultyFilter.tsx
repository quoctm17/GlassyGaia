import { useState, useEffect, useRef } from 'react';
import { Flame } from 'lucide-react';

interface DifficultyFilterProps {
  minDifficulty: number;
  maxDifficulty: number;
  onDifficultyChange: (min: number, max: number) => void;
}

export default function DifficultyFilter({ minDifficulty, maxDifficulty, onDifficultyChange }: DifficultyFilterProps) {
  const [localMin, setLocalMin] = useState(minDifficulty);
  const [localMax, setLocalMax] = useState(maxDifficulty);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);

  // Sync with parent when parent changes externally
  useEffect(() => {
    setLocalMin(minDifficulty);
    setLocalMax(maxDifficulty);
  }, [minDifficulty, maxDifficulty]);

  // Debounced update to parent (500ms)
  const debouncedUpdate = (min: number, max: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onDifficultyChange(min, max);
    }, 500);
  };

  const handleMinChange = (value: number) => {
    const newMin = Math.max(0, Math.min(value, localMax));
    setLocalMin(newMin);
    debouncedUpdate(newMin, localMax);
  };

  const handleMaxChange = (value: number) => {
    const newMax = Math.min(100, Math.max(value, localMin));
    setLocalMax(newMax);
    debouncedUpdate(localMin, newMax);
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || dragging) return;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    const value = Math.round(percent);
    
    // Click closer to min or max handle
    const distToMin = Math.abs(value - localMin);
    const distToMax = Math.abs(value - localMax);
    
    if (distToMin < distToMax) {
      handleMinChange(value);
    } else {
      handleMaxChange(value);
    }
  };

  return (
    <div className="difficulty-block">
      <div className="difficulty-title">DIFFICULTY SCORE</div>
      
      {/* Input fields */}
      <div className="difficulty-range-row">
        <div className="difficulty-input">
          <label className="diff-label">MIN</label>
          <input
            type="number"
            min={0}
            max={100}
            value={localMin}
            onChange={e => handleMinChange(Number(e.target.value))}
          />
        </div>
        <div className="difficulty-input">
          <label className="diff-label">MAX</label>
          <input
            type="number"
            min={0}
            max={100}
            value={localMax}
            onChange={e => handleMaxChange(Number(e.target.value))}
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
          {/* Active range highlight */}
          <div 
            className="difficulty-track-active"
            style={{
              left: `${localMin}%`,
              width: `${localMax - localMin}%`
            }}
          />
          
          {/* Min handle */}
          <div
            className="difficulty-handle"
            style={{ left: `${localMin}%` }}
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
            style={{ left: `${localMax}%` }}
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
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const percent = ((e.clientX - rect.left) / rect.width) * 100;
            const value = Math.max(0, Math.min(100, Math.round(percent)));
            
            if (dragging === 'min') {
              handleMinChange(value);
            } else {
              handleMaxChange(value);
            }
          }}
          onMouseUp={() => setDragging(null)}
          onTouchMove={(e) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const touch = e.touches[0];
            const percent = ((touch.clientX - rect.left) / rect.width) * 100;
            const value = Math.max(0, Math.min(100, Math.round(percent)));
            
            if (dragging === 'min') {
              handleMinChange(value);
            } else {
              handleMaxChange(value);
            }
          }}
          onTouchEnd={() => setDragging(null)}
        />
      )}
    </div>
  );
}
