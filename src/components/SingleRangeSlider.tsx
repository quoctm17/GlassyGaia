import { useRef, useEffect } from 'react';

interface SingleRangeSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}

export default function SingleRangeSlider({
  min,
  max,
  value,
  onChange,
  step = 1
}: SingleRangeSliderProps) {
  const sliderRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Convert to percentage
  const getPercent = (val: number) => {
    if (max === min) return 100;
    return Math.round(((val - min) / (max - min)) * 100);
  };
  
  // Optimized update function using requestAnimationFrame
  const updateRange = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      if (!rangeRef.current || !containerRef.current) return;
      
      const percent = getPercent(value);
      const containerWidth = containerRef.current.offsetWidth;
      if (containerWidth === 0) return;
      
      const trackWidth = containerWidth - 16;
      const width = (percent / 100) * trackWidth;
      
      rangeRef.current.style.left = '8px';
      rangeRef.current.style.width = `${width}px`;
    });
  };

  // Update range when value, min, or max changes
  useEffect(() => {
    // Use double setTimeout to ensure DOM is ready and container has width
    const timeoutId1 = setTimeout(() => {
      updateRange();
    }, 0);
    
    const timeoutId2 = setTimeout(() => {
      updateRange();
    }, 50);
    
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, min, max]);

  // Update range on window resize and when component mounts
  useEffect(() => {
    const handleResize = () => {
      updateRange();
    };
    
    window.addEventListener('resize', handleResize);
    // Multiple timeouts to ensure range updates after DOM is fully rendered
    const timeoutId1 = setTimeout(updateRange, 0);
    const timeoutId2 = setTimeout(updateRange, 100);
    const timeoutId3 = setTimeout(updateRange, 200);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      clearTimeout(timeoutId3);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, min, max]);

  return (
    <div className="dual-range-slider-container" ref={containerRef}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        ref={sliderRef}
        onChange={(event) => {
          const newValue = +event.target.value;
          requestAnimationFrame(() => {
            onChange(newValue);
          });
        }}
        className="dual-range-slider"
        step={step}
      />
      <div className="dual-range-slider-range" ref={rangeRef} />
    </div>
  );
}

