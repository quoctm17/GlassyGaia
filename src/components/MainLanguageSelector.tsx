import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { langLabel, countryCodeForLang } from "../utils/lang";
import { getAvailableLanguagesForFilm } from "../services/firestore";
import { ChevronDown } from "lucide-react";

interface Props {
  filmId?: string; // optional: fallback to global if not provided
  optionsOverride?: string[]; // explicit list if provided
  className?: string;
  onChange?: (lang: string) => void; // notify parent
}

export default function MainLanguageSelector({ filmId = "global", optionsOverride, className, onChange }: Props) {
  const { preferences, setMainLanguage } = useUser();
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const current = preferences.main_language || "en";

  useEffect(() => {
    const load = async () => {
      const langs = optionsOverride ?? (await getAvailableLanguagesForFilm(filmId));
      const sorted = [...(langs || ["en"])].sort((a, b) => {
        if (a === "en" && b !== "en") return -1;
        if (b === "en" && a !== "en") return 1;
        return a.localeCompare(b);
      });
      if (!sorted.includes(current)) sorted.unshift(current); // ensure current present
      setOptions(Array.from(new Set(sorted)));
    };
    load().catch(() => setOptions([current]));
  }, [filmId, optionsOverride, current]);

  const apply = async (lang: string) => {
    await setMainLanguage(lang);
    onChange?.(lang);
    setOpen(false);
  };

  return (
    <div className={"relative " + (className || "")}>
      <button
        onClick={() => setOpen(v => !v)}
        className="pixel-pill text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`fi fi-${countryCodeForLang(current)} w-5 h-3.5`}></span>
        <span>{langLabel(current)}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-md bg-gray-900 border-2 border-pink-500 shadow-xl z-50 p-2">
          <div className="max-h-64 overflow-auto pr-1 space-y-1">
            {options.map(l => (
              <button
                key={l}
                onClick={() => apply(l)}
                className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-sm hover:bg-pink-600/30 ${l===current? 'bg-pink-600/40':''}`}
              >
                <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                <span>{langLabel(l)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
