import { useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import type { FilmDoc } from '../types';
import PortalDropdown from './PortalDropdown';

interface ContentFilterPanelProps {
  items: FilmDoc[]; // all content items
  selectedYear: string | null;
  onYearChange: (year: string | null) => void;
}

export default function ContentFilterPanel({ 
  items, 
  selectedYear, 
  onYearChange
}: ContentFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Extract unique release years from items
  const availableYears: number[] = (() => {
    const years = new Set<number>();
    items.forEach(item => {
      if (typeof item.release_year === 'number' && item.release_year > 0) {
        years.add(item.release_year);
      }
    });
    return Array.from(years).sort((a, b) => b - a); // descending order
  })();

  const handleClose = () => {
    if (!closing) {
      setClosing(true);
      setTimeout(() => { setOpen(false); setClosing(false); }, 200);
    }
  };

  const handleYearSelect = (year: string | null) => {
    onYearChange(year);
    handleClose();
  };

  return (
    <div>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) {
            handleClose();
          } else {
            setOpen(true);
          }
        }}
        className="flex items-center gap-2 px-4 py-2 bg-pink-600/20 hover:bg-pink-600/30 text-pink-400 rounded-lg transition-colors border border-pink-500/50 hover:border-pink-500"
      >
        <Filter size={16} className="text-pink-400" />
        <span className="font-medium text-sm">Filters</span>
      </button>

      {(open || closing) && btnRef.current && (
        <PortalDropdown
          anchorEl={btnRef.current}
          onClose={handleClose}
          align="left"
          offset={8}
          className="language-dropdown"
          durationMs={200}
          closing={closing}
          minWidth={220}
        >
          <div className="language-options-header">Release Year</div>
          <div className="language-options-list max-h-[280px] overflow-y-auto">
            <button
              onClick={() => handleYearSelect(null)}
              className={`language-option ${selectedYear === null ? 'active' : ''}`}
            >
              <span>All Years</span>
            </button>
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => handleYearSelect(String(year))}
                className={`language-option ${selectedYear === String(year) ? 'active' : ''}`}
              >
                <span>{year}</span>
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}
