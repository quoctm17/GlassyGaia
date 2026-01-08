import { useState, useRef, useEffect } from 'react';

interface DualRangeSliderProps {
  min: number;
  max: number;
  minValue: number;
  maxValue: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
  step?: number;
}

export default function DualRangeSlider({
  min,
  max,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  step = 1
}: DualRangeSliderProps) {
  const [minVal, setMinVal] = useState(minValue);
  const [maxVal, setMaxVal] = useState(maxValue);
  const minValRef = useRef<HTMLInputElement>(null);
  const maxValRef = useRef<HTMLInputElement>(null);
  const range = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Convert to percentage
  const getPercent = (value: number) => Math.round(((value - min) / (max - min)) * 100);
  
  // Optimized update function using requestAnimationFrame
  const updateRange = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      if (!range.current || !containerRef.current) return;
      
      const minPercent = getPercent(minVal);
      const maxPercent = getPercent(maxVal);
      
      const containerWidth = containerRef.current.offsetWidth;
      if (containerWidth === 0) return;
      
      const trackWidth = containerWidth - 16;
      
      const leftPosition = 8 + (minPercent / 100) * trackWidth;
      const width = ((maxPercent - minPercent) / 100) * trackWidth;
      
      range.current.style.left = `${leftPosition}px`;
      range.current.style.width = `${width}px`;
    });
  };

  // Update range when values change (optimized)
  useEffect(() => {
    updateRange();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [minVal, maxVal]);

  // Update range on window resize
  useEffect(() => {
    const handleResize = () => {
      updateRange();
    };
    
    window.addEventListener('resize', handleResize);
    const timeoutId = setTimeout(updateRange, 0);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [minVal, maxVal]);

  // Sync with external values
  useEffect(() => {
    setMinVal(minValue);
  }, [minValue]);

  useEffect(() => {
    setMaxVal(maxValue);
  }, [maxValue]);

  return (
    <div className="dual-range-slider-container" ref={containerRef}>
      <input
        type="range"
        min={min}
        max={max}
        value={minVal}
        ref={minValRef}
        onChange={(event) => {
          const value = Math.min(+event.target.value, maxVal - step);
          setMinVal(value);
          // Debounce callback to reduce lag
          requestAnimationFrame(() => {
            onMinChange(value);
          });
        }}
        className="dual-range-slider dual-range-slider-min"
        step={step}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={maxVal}
        ref={maxValRef}
        onChange={(event) => {
          const value = Math.max(+event.target.value, minVal + step);
          setMaxVal(value);
          // Debounce callback to reduce lag
          requestAnimationFrame(() => {
            onMaxChange(value);
          });
        }}
        className="dual-range-slider dual-range-slider-max"
        step={step}
      />
      <div className="dual-range-slider-range" ref={range} />
    </div>
  );
}

