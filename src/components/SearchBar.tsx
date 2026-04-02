import { useState, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import "../styles/components/search-bar.css";
import searchIcon from "../assets/icons/search.svg";
import saveHeartIcon from "../assets/icons/save-heart.svg";
import toast from 'react-hot-toast';
import { useUser } from "../context/UserContext";

export interface SearchBarProps {
  value?: string; // controlled value
  defaultValue?: string; // uncontrolled initial value
  onChange?: (v: string) => void; // fires on input change
  onSearch?: (v: string) => void; // fires when search button clicked or Enter pressed
  onClear?: () => void; // fires when clear button clicked
  placeholder?: string;
  showClear?: boolean; // whether to show clear button when query non-empty
  autoFocus?: boolean;
  loading?: boolean; // show loading indicator
  showSavedFilter?: boolean; // whether saved-filter is active (parent-controlled)
  onSavedFilterChange?: (show: boolean) => void; // fires when save-filter button is toggled
}

export default function SearchBar({
  value,
  defaultValue = "",
  onChange,
  onSearch,
  onClear,
  placeholder = "SEARCH...",
  showClear = true,
  autoFocus = false,
  loading = false,
  showSavedFilter = false,
  onSavedFilterChange,
}: SearchBarProps) {
  const { user } = useUser();
  const controlled = typeof value === "string" && onChange;
  const [internalQuery, setInternalQuery] = useState<string>(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // keep internal state synced if parent drives value
  useEffect(() => {
    if (controlled) setInternalQuery(value as string);
  }, [value, controlled]);

  const q = controlled ? (value as string) : internalQuery;

  const handleChange = (v: string) => {
    if (controlled) {
      onChange?.(v);
    } else {
      setInternalQuery(v);
      onChange?.(v); // still notify
    }
  };

  const triggerSearch = () => {
    onSearch?.(q);
  };

  const clear = () => {
    if (controlled) {
      onChange?.("");
    } else {
      setInternalQuery("");
    }
    onClear?.();
    // After clearing also trigger an empty search
    onSearch?.("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") triggerSearch();
    if (e.key === "Escape" && q && showClear) clear();
  };

  return (
    <div className="pixel-searchbar">
      <div className="pixel-input-wrapper">
        <div className="search-input-area">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pixel-input text-center"
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
          {showClear && q && (
            <button
              type="button"
              aria-label="Clear"
              onClick={clear}
              className="search-clear-btn"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`search-bar-save-btn ${showSavedFilter ? 'active' : ''}`}
          aria-label={showSavedFilter ? 'Show all cards' : 'Show saved cards only'}
          aria-pressed={showSavedFilter}
          onClick={() => {
            if (!user?.uid) {
              toast.error('Please sign in to filter saved cards.');
              return;
            }
            onSavedFilterChange?.(!showSavedFilter);
          }}
        >
          {showSavedFilter ? (
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="search-bar-save-icon">
              <path d="M12.95 16h1.52v1.52H16v1.53h1.52v1.52h1.52v-1.52h1.53v-1.53h1.52V16h1.53v-1.53h1.52V9.9h-1.52V8.38h-4.58V9.9h-1.52V8.38h-4.57V9.9h-1.52v4.57h1.52V16z" fill="var(--hover-select)"/>
              <path d="M6.85.76h22.86v1.52H6.85Z" fill="var(--hover-select)"/>
              <path d="M3.81 26.66h1.52v1.53H3.81Z" fill="var(--hover-select)"/>
              <path d="M3.81 26.66v-1.52H2.28v-3.05h1.53v-1.52H2.28v-3.05h1.53V16H2.28v-3.05h1.53v-1.52H2.28V8.38h1.53V6.85h1.52v1.53H3.81V9.9h1.52v3.05H3.81v1.52h1.52v3.05H3.81v1.53h1.52v3.04H3.81v1.53h1.52v1.52h1.52V2.28H5.33v3.05H2.28v1.52H.76v22.86h1.52v-3.05h1.53z" fill="var(--hover-select)"/>
            </svg>
          ) : (
            <img src={saveHeartIcon} alt="" className="search-bar-save-icon" />
          )}
        </button>
        <button
          type="button"
          onClick={triggerSearch}
          className="search-trigger-btn"
          aria-label="Search"
        >
          {loading ? (
            <Loader2
              className="search-trigger-loader"
              style={{ color: 'var(--hover-select)' }}
              strokeWidth={2.2}
            />
          ) : (
            <>
              <img src={searchIcon} alt="" className="search-trigger-icon" />
              <span className="search-trigger-text">Search</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
