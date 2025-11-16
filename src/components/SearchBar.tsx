import { useState, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";

export interface SearchBarProps {
  value?: string; // controlled value
  defaultValue?: string; // uncontrolled initial value
  onChange?: (v: string) => void; // fires on input change
  onSearch?: (v: string) => void; // fires when search button clicked or Enter pressed
  onClear?: () => void; // fires when clear button clicked
  placeholder?: string;
  showClear?: boolean; // whether to show clear button when query non-empty
  buttonLabel?: string; // override 'Search by'
  autoFocus?: boolean;
  loading?: boolean; // show loading indicator
}

export default function SearchBar({
  value,
  defaultValue = "",
  onChange,
  onSearch,
  onClear,
  placeholder = "SEARCH...",
  showClear = true,
  buttonLabel = "Search by",
  autoFocus = false,
  loading = false,
}: SearchBarProps) {
  const controlled = typeof value === "string" && onChange;
  const [internalQuery, setInternalQuery] = useState<string>(defaultValue);

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

  return (
    <div className="pixel-searchbar">
      <div className="pixel-input-wrapper">
        {loading ? (
          <Loader2 className="pixel-input-icon animate-spin" />
        ) : (
          <Search className="pixel-input-icon" />
        )}
        <input
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") triggerSearch();
            if (e.key === "Escape" && q && showClear) clear();
          }}
          className="pixel-input"
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
      <button
        className="pixel-search-btn"
        type="button"
        onClick={triggerSearch}
        disabled={!q && buttonLabel.toLowerCase().includes("search")}
      >
        <Search className="w-4 h-4" />
        <span>{buttonLabel}</span>
      </button>
    </div>
  );
}