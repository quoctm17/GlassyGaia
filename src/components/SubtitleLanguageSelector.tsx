import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { langLabel, countryCodeForLang } from "../utils/lang";
import { getAvailableLanguagesForFilm } from "../services/firestore";
import { ChevronDown, Plus, Minus } from "lucide-react";
import { toast } from "react-hot-toast";

interface Props {
  filmId?: string;
  optionsOverride?: string[];
  className?: string;
  maxSelections?: number; // default 3
  onChange?: (langs: string[]) => void;
}

export default function SubtitleLanguageSelector({ filmId = "global", optionsOverride, className, maxSelections = 3, onChange }: Props) {
  const { preferences, setSubtitleLanguages } = useUser();
  const main = preferences.main_language || "en";
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<string[]>(preferences.subtitle_languages || []);

  useEffect(() => {
    const load = async () => {
      const langs = optionsOverride ?? (await getAvailableLanguagesForFilm(filmId));
      const filtered = (langs || []).filter(l => l !== main); // exclude main
      const sorted = [...filtered].sort((a,b)=>{
        if (a === "en" && b !== "en") return -1;
        if (b === "en" && a !== "en") return 1;
        return a.localeCompare(b);
      });
      setOptions(sorted);
      // Sync local ensuring exclusion of main and within options
      const base = (preferences.subtitle_languages || []).filter(l => l !== main && sorted.includes(l));
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
        toast.error(`Chỉ chọn tối đa ${maxSelections} ngôn ngữ phụ`);
        return;
      }
      next = [...local, code];
    }
    setLocal(next);
  };

  const apply = async () => {
    if (local.length === 0) {
      // allow zero selection
    }
    await setSubtitleLanguages(local);
    onChange?.(local);
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
        <span className="flex items-center gap-1">
          <span className={`fi fi-${countryCodeForLang(main)} w-5 h-3.5 opacity-70`}></span>
        </span>
        <span>{local.length ? `${local.length} subtitle${local.length>1?'s':''}` : 'Subtitles'}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 z-50 pixel-filter-panel p-2">
          <div className="flex items-center justify-between px-1 pb-1">
            <div className="text-[11px] text-pink-200/80">Chọn tối đa {maxSelections}</div>
            <div className="space-x-2">
              <button className="text-xs text-pink-200 hover:text-white" onClick={() => setLocal([])}>Clear</button>
            </div>
          </div>
          {options.length === 0 && (
            <div className="px-2 py-1 text-sm text-pink-200/80">Không có ngôn ngữ phụ</div>
          )}
          {options.map((lang) => {
            const active = local.includes(lang);
            return (
              <button
                key={lang}
                onClick={() => toggle(lang)}
                className={`pixel-filter-btn flex items-center gap-2 ${active ? 'active' : ''}`}
              >
                {active ? <Minus className="w-4 h-4 text-pink-200" /> : <Plus className="w-4 h-4 text-pink-200" />}
                <span className={`fi fi-${countryCodeForLang(lang)} w-5 h-3.5`}></span>
                <span>{langLabel(lang)}</span>
              </button>
            );
          })}
          <div className="mt-2 flex justify-end gap-2 px-2">
            <button className="pixel-btn-fav active text-xs" onClick={apply}>Apply</button>
            <button className="pixel-btn-fav text-xs" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
