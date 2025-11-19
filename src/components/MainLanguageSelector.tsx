import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { langLabel, countryCodeForLang } from "../utils/lang";
import { getAvailableMainLanguages, getFilmDoc } from "../services/firestore";
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
  const [local, setLocal] = useState<string>(current);

  useEffect(() => {
    const load = async () => {
      // For global selector, show only languages that are actually main_language of items
      let langs: string[] | undefined = optionsOverride;
      if (!langs) {
        if (filmId === "global") {
          langs = await getAvailableMainLanguages();
        } else {
          const f = await getFilmDoc(filmId);
          langs = f?.main_language ? [f.main_language] : await getAvailableMainLanguages();
        }
      }
      const sorted = [...(langs || ["en"])].sort((a, b) => {
        if (a === "en" && b !== "en") return -1;
        if (b === "en" && a !== "en") return 1;
        return a.localeCompare(b);
      });
      if (!sorted.includes(current)) sorted.unshift(current); // ensure current present
      setOptions(Array.from(new Set(sorted)));
      setLocal(current);
    };
    load().catch(() => {
      setOptions([current]);
      setLocal(current);
    });
  }, [filmId, optionsOverride, current]);

  const apply = async () => {
    const lang = local || current;
    await setMainLanguage(lang);
    onChange?.(lang);
    setOpen(false);
  };

  // If the current saved main language is not in the available list (e.g., only EN exists),
  // automatically reset it to the first available so the search doesn’t return 0 results.
  useEffect(() => {
    if (options.length > 0 && !options.includes(current)) {
      const fallback = options[0];
      setLocal(fallback);
      setMainLanguage(fallback);
      onChange?.(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

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
        <div className="absolute right-0 mt-2 w-64 z-50 pixel-filter-panel p-2">
          <div className="flex items-center justify-between px-1 pb-1">
            <div className="text-[11px] text-pink-200/80">Select one language</div>
          </div>
          {options.length === 0 && (
            <div className="px-2 py-1 text-sm text-pink-200/80">No languages</div>
          )}
          {options.map((l) => {
            const active = local === l;
            return (
              <button
                key={l}
                onClick={() => setLocal(l)}
                className={`pixel-filter-btn flex items-center gap-2 ${active ? 'active' : ''}`}
              >
                <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                <span>{langLabel(l)}</span>
              </button>
            );
          })}
          <div className="mt-2 flex justify-end gap-2 px-2">
            <button className="pixel-btn-fav active text-xs" onClick={apply}>Apply</button>
            <button className="pixel-btn-fav text-xs" onClick={() => { setLocal(current); setOpen(false); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
