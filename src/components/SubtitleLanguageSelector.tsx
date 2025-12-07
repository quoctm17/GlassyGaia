import { useEffect, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { langLabel, canonicalizeLangCode, getFlagImageForLang } from "../utils/lang";
import { getAvailableLanguagesForFilm } from "../services/firestore";
import { ChevronDown, Languages } from "lucide-react";
import PortalDropdown from "./PortalDropdown";
import { toast } from "react-hot-toast";
import "../styles/components/language-selectors.css";

interface Props {
  filmId?: string;
  optionsOverride?: string[];
  className?: string;
  maxSelections?: number; // default 3
  onChange?: (langs: string[]) => void;
}

export default function SubtitleLanguageSelector({ filmId = "global", optionsOverride, className, maxSelections = 3, onChange }: Props) {
  const { preferences, setSubtitleLanguages, openLanguageSelector, setOpenLanguageSelector } = useUser();
  const main = (canonicalizeLangCode(preferences.main_language || "en") || "en");
  const [options, setOptions] = useState<string[]>([]);
  const [local, setLocal] = useState<string[]>(preferences.subtitle_languages || []);
  const open = openLanguageSelector === "subtitle";
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      const langs = optionsOverride ?? (await getAvailableLanguagesForFilm(filmId));
      const filtered = (langs || []).filter(l => (canonicalizeLangCode(l) || l) !== main); // exclude main (canonical)
      const sorted = [...filtered].sort((a,b)=> a.localeCompare(b)); // pure A-Z
      setOptions(sorted);
      // Sync local ensuring exclusion of main and within options
      const base = (preferences.subtitle_languages || []).filter(l => (canonicalizeLangCode(l) || l) !== main && sorted.includes(l));
      setLocal(base);
    };
    load().catch(() => setOptions([]));
  }, [filmId, optionsOverride, main, preferences.subtitle_languages]);

  const toggle = (code: string) => {
    let next: string[];
    if (local.includes(code)) {
      next = local.filter(l => l !== code);
    } else {
      if (local.length >= maxSelections) {
        toast.error(`You can select up to ${maxSelections} subtitle${maxSelections>1?'s':''}.`);
        return;
      }
      next = [...local, code];
    }
    setLocal(next);
  };

  const apply = async () => {
    await setSubtitleLanguages(local);
    onChange?.(local);
    setClosing(true);
    setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 500);
  };

  const clearAll = async () => {
    setLocal([]);
    await setSubtitleLanguages([]);
    onChange?.([]);
  };

  return (
    <div className={"relative " + (className || "")}>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) {
            setClosing(true);
            setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 200);
          } else {
            setOpenLanguageSelector("subtitle");
          }
        }}
        className="language-selector-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Languages className="w-4 h-4 opacity-80" />
        <span>{local.length}/{maxSelections} SUBS</span>
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
          <div className="subtitle-options-header">
            <span>{local.length}/{maxSelections}</span>
            <span className="subtitle-clear-btn" onClick={clearAll}>Clear</span>
            <span className="subtitle-done-btn" onClick={apply}>Done</span>
          </div>
          <div className="px-1 mb-2">
            <input
              type="text"
              value={query}
              onChange={(e)=>setQuery(e.target.value)}
              placeholder="Search..."
              className="language-search-input"
            />
          </div>
          <div className="language-options-list">
            {options.length === 0 && (
              <div className="px-2 py-1 text-xs text-pink-200/80">No subtitle languages</div>
            )}
            {options.filter(l => {
              const q = query.trim().toLowerCase();
              if (!q) return true;
              const label = langLabel(l).toLowerCase();
              // normalize accents
              const normalize = (s:string) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'');
              return normalize(l.toLowerCase()).includes(q) || normalize(label).includes(q);
            })
              .map((lang) => {
              const active = local.includes(lang);
              return (
                <button
                  key={lang}
                  onClick={() => toggle(lang)}
                  className={`language-option ${active ? 'active' : ''}`}
                >
                  <img src={getFlagImageForLang(lang)} alt={`${lang} flag`} className="w-5 h-3.5 rounded" />
                  <span>{langLabel(lang)}</span>
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}
