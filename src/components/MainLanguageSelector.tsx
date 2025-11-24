import { useEffect, useRef, useState } from "react";
import PortalDropdown from "./PortalDropdown";
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
  const { preferences, setMainLanguage, openLanguageSelector, setOpenLanguageSelector } = useUser();
  const [options, setOptions] = useState<string[]>([]);
  const current = preferences.main_language || "en";
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const open = openLanguageSelector === "main";
  const [closing, setClosing] = useState(false);

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
      const sorted = Array.from(new Set(langs || ["en"]))
        .sort((a, b) => a.localeCompare(b)); // pure A-Z sort
      if (!sorted.includes(current)) sorted.unshift(current); // ensure current present
      setOptions(sorted);
    };
    load().catch(() => {
      setOptions([current]);
    });
  }, [filmId, optionsOverride, current]);

  // Immediate apply handled in option click; keep fallback logic below.

  // If the current saved main language is not in the available list (e.g., only EN exists),
  // automatically reset it to the first available so the search doesn’t return 0 results.
  useEffect(() => {
    if (options.length > 0 && !options.includes(current)) {
      const fallback = options[0];
      setMainLanguage(fallback);
      onChange?.(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return (
    <div className={"relative " + (className || "")}>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) {
            setClosing(true);
            setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 200);
          } else {
            // open instantly (no pre-delay)
            setOpenLanguageSelector("main");
          }
        }}
        className="language-selector-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`fi fi-${countryCodeForLang(current)} w-5 h-3.5`}></span>
        <span>{langLabel(current)}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      {(open || closing) && btnRef.current && (
        <PortalDropdown
          anchorEl={btnRef.current}
          onClose={() => {
            if (!closing) {
              setClosing(true);
              setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 200);
            }
          }}
          align="center"
          offset={10}
          className="language-dropdown"
          durationMs={200}
          closing={closing}
        >
          <div className="language-options-header">Select language</div>
          <div className="language-options-list">
            {options.length === 0 && (
              <div className="px-2 py-1 text-xs text-pink-200/80">No languages</div>
            )}
            {options.map((l) => {
              const active = current === l; // highlight saved language
              return (
                <button
                  key={l}
                  onClick={() => { setMainLanguage(l); onChange?.(l); setClosing(true); setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 500); }}
                  className={`language-option ${active ? 'active' : ''}`}
                >
                  <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                  <span>{langLabel(l)}</span>
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}
