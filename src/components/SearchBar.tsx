import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2 } from "lucide-react";
import "../styles/components/search-bar.css";
import searchIcon from "../assets/icons/search.svg";
import { apiSearchAutocomplete } from "../services/cfApi";

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
  enableAutocomplete?: boolean; // enable autocomplete suggestions
  autocompleteLanguage?: string | null; // filter suggestions by language
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
  enableAutocomplete = true,
  autocompleteLanguage = null,
}: SearchBarProps) {
  const controlled = typeof value === "string" && onChange;
  const [internalQuery, setInternalQuery] = useState<string>(defaultValue);
  const [suggestions, setSuggestions] = useState<Array<{ term: string; frequency: number; language: string | null }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // keep internal state synced if parent drives value
  useEffect(() => {
    if (controlled) setInternalQuery(value as string);
  }, [value, controlled]);

  const q = controlled ? (value as string) : internalQuery;

  // Fetch autocomplete suggestions (debounced)
  useEffect(() => {
    if (!enableAutocomplete) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoadingSuggestions(true);

    const timeoutId = setTimeout(async () => {
      try {
        const result = await apiSearchAutocomplete({
          q: trimmed,
          language: autocompleteLanguage || undefined,
          limit: 10,
        });
        
        if (!controller.signal.aborted) {
          setSuggestions(result.suggestions);
          setShowSuggestions(result.suggestions.length > 0);
          setSelectedIndex(-1);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch autocomplete suggestions:', error);
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSuggestions(false);
        }
      }
    }, 200); // 200ms debounce for autocomplete

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [q, enableAutocomplete, autocompleteLanguage]);

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
    setSelectedIndex(-1);
  };

  const handleSelectSuggestion = useCallback((term: string) => {
    if (controlled) {
      onChange?.(term);
    } else {
      setInternalQuery(term);
      onChange?.(term);
    }
    setShowSuggestions(false);
    setSelectedIndex(-1);
    // Trigger search immediately when suggestion is selected
    onSearch?.(term);
    inputRef.current?.blur();
  }, [controlled, onChange, onSearch]);

  const triggerSearch = () => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
    onSearch?.(q);
  };

  const clear = () => {
    if (controlled) {
      onChange?.("");
    } else {
      setInternalQuery("");
    }
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    onClear?.();
    // After clearing also trigger an empty search
    onSearch?.("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") triggerSearch();
      if (e.key === "Escape" && q && showClear) clear();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelectSuggestion(suggestions[selectedIndex].term);
        } else {
          triggerSearch();
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedIndex(-1);
        if (q && showClear) clear();
        break;
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSuggestions]);

  return (
    <div className="pixel-searchbar">
      <div className="pixel-input-wrapper" style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={triggerSearch}
          className="absolute inset-y-0 left-[14px] w-5 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity z-10"
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
          ref={inputRef}
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
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
            className="absolute right-2 top-1/2 -translate-y-1/2 text-pink-600 hover:text-pink-800 z-10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        
        {/* Autocomplete suggestions dropdown */}
        {enableAutocomplete && showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="search-autocomplete-dropdown"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '4px',
              backgroundColor: 'var(--sidenav-bg)',
              border: '2px solid var(--neutral)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              zIndex: 1000,
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {loadingSuggestions && (
              <div style={{ padding: '12px', textAlign: 'center', color: 'var(--neutral)' }}>
                Loading...
              </div>
            )}
            {!loadingSuggestions && suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.term}-${index}`}
                onClick={() => handleSelectSuggestion(suggestion.term)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  backgroundColor: selectedIndex === index ? 'var(--hover-bg)' : 'transparent',
                  color: 'var(--text)',
                  borderBottom: index < suggestions.length - 1 ? '1px solid var(--neutral)' : 'none',
                  transition: 'background-color 0.15s',
                }}
              >
                <div style={{ fontWeight: 500, fontSize: '15px' }}>{suggestion.term}</div>
                {suggestion.language && (
                  <div style={{ fontSize: '12px', color: 'var(--neutral)', marginTop: '2px' }}>
                    {suggestion.language}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}