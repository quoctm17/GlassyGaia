import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  allowClear?: boolean;
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  searchable = false,
  className = "",
  allowClear = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = searchable && query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        className="admin-input flex items-center justify-between w-full"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <span className="inline-flex items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className="truncate">{selectedOption?.label || placeholder}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
          {searchable && (
            <div className="sticky top-0 z-10 p-2 border-b" style={{ background: 'var(--background)', borderColor: 'var(--primary)' }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="admin-input text-xs py-1 px-2 w-full"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {filteredOptions.map((opt) => (
            <div
              key={opt.value}
              className="admin-dropdown-item"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setQuery("");
              }}
            >
              {opt.icon}
              <span className="text-sm">{opt.label}</span>
            </div>
          ))}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-2 text-xs text-pink-200/70">
              No matches for "{query}".
            </div>
          )}
          {allowClear && value && (
            <div
              className="admin-dropdown-clear"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
            >
              Clear
            </div>
          )}
        </div>
      )}
    </div>
  );
}
