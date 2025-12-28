import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import "../styles/components/search-bar.css";
import searchIcon from "../assets/icons/search.svg";

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
  debounceMs?: number; // auto-search debounce
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
  debounceMs = 0, // Changed default to 0 - let parent handle debounce
}: SearchBarProps) {
  const controlled = typeof value === "string" && onChange;
  const [internalQuery, setInternalQuery] = useState<string>(defaultValue);

  // keep internal state synced if parent drives value
  useEffect(() => {
    if (controlled) setInternalQuery(value as string);
  }, [value, controlled]);

  const q = controlled ? (value as string) : internalQuery;

  // Auto-trigger debounced search on input changes (only if debounceMs > 0)
  useEffect(() => {
    const ms = Math.max(0, debounceMs || 0);
    if (ms > 0) {
      const handle = setTimeout(() => {
        onSearch?.(q);
      }, ms);
      return () => clearTimeout(handle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, debounceMs]);

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

  return (
    <div className="pixel-searchbar">
      <div className="pixel-input-wrapper">
        <button
          type="button"
          onClick={triggerSearch}
          className="absolute inset-y-0 left-[14px] w-5 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
          aria-label="Search"
        >
          {loading ? (
            <Loader2
              className="w-5 h-5 animate-spin"
              style={{ color: 'var(--hover-select, #ec4899)' }}
              strokeWidth={2.2}
            />
          ) : (
            <img src={searchIcon} alt="Search" className="search-icon" />
          )}
        </button>
        <div className="search-bar-divider" />
        <input
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") triggerSearch();
            if (e.key === "Escape" && q && showClear) clear();
          }}
          className="pixel-input text-center"
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        {showClear && q && (
          <button
            type="button"
            aria-label="Clear"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-pink-600 hover:text-pink-800"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}