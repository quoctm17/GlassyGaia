import { useEffect, useState } from "react";
import { getAvailableLanguagesForFilm } from "../services/firestore";
import { useUser } from "../context/UserContext";
import { langLabel, countryCodeForLang } from "../utils/lang";

interface Props {
	filmId: string; // e.g., "go_ahead" or a pseudo id in global search
	className?: string; // allow fixed positioning from parent
	optionsOverride?: string[]; // if provided, skip fetching from film
	onApply?: (langs: string[]) => void; // legacy callback (langs only)
  // onApplyWithMode is deprecated; search no longer depends on language selection
  onApplyWithMode?: (langs: string[], requireAll: boolean) => void; // kept for backward compatibility (no-ops)
}

const LABELS: Record<string, string> = {
	en: "English",
	vi: "Vietnamese",
	ja: "Japanese",
	ko: "Korean",
	zh: "Chinese (Simplified)",
	id: "Indonesian",
	th: "Thai",
	ms: "Malay",
};

export default function LanguageSelector({ filmId, className, optionsOverride, onApply, onApplyWithMode }: Props) {
	const { preferences, setSubtitleLanguages } = useUser();
	const [options, setOptions] = useState<string[]>([]);
	const [open, setOpen] = useState(false);
	const [local, setLocal] = useState<string[]>(preferences.subtitle_languages || []);

			useEffect(() => {
			const load = async () => {
				const langs = optionsOverride ?? (await getAvailableLanguagesForFilm(filmId));
				const sorted = [...(langs || [])].sort((a, b) => {
					if (a === "en" && b !== "en") return -1;
					if (b === "en" && a !== "en") return 1;
					return a.localeCompare(b);
				});
				setOptions(sorted);
					// Sync local selection to current preferences intersect options
					const base = (preferences.subtitle_languages || []).filter((l) => sorted.includes(l));
					setLocal(base);
			};
			load().catch(() => setOptions([]));
			}, [filmId, optionsOverride, preferences.subtitle_languages]);

		const selected = new Set(local);
		const toggleLocal = (code: string) => {
			const next = new Set(selected);
			if (next.has(code)) next.delete(code);
			else next.add(code);
			setLocal([...next]);
		};

		const apply = async () => {
			await setSubtitleLanguages(local);
			// Search no longer depends on language selection; callbacks are UI-only
      if (onApply) onApply(local);
      else if (onApplyWithMode) onApplyWithMode(local, false);
			setOpen(false);
		};

		return (
	    <div className={"relative " + (className ?? "")}> 
	      <button
	        onClick={() => setOpen((v) => !v)}
	        className="px-3 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-sm transition-colors border border-gray-600 shadow"
	        aria-haspopup="listbox"
	        aria-expanded={open}
	        title="Select subtitle languages"
	      >
	        🌐 Subtitles
	      </button>
						{open && (
					<div className="absolute right-0 mt-2 w-64 rounded-md bg-gray-800 shadow-xl p-2 border border-gray-700 z-50">
								<div className="flex items-center justify-between px-2 pb-1">
							<div className="text-xs text-gray-400">Available</div>
									<div className="space-x-2">
										<button
											className="text-xs text-gray-300 hover:text-white"
											onClick={() => setLocal([])}
										>
											Clear all
										</button>
										<button
											className="text-xs text-gray-300 hover:text-white"
											onClick={() => setLocal(options)}
										>
											Select all
										</button>
									</div>
						</div>
	          {options.length === 0 && (
	            <div className="px-2 py-1 text-sm text-gray-400">No languages</div>
	          )}
						{options.map((lang) => (
							<label key={lang} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-700 rounded cursor-pointer">
	              <input
	                type="checkbox"
									checked={selected.has(lang)}
									onChange={() => toggleLocal(lang)}
	              />
								<span className={`fi fi-${countryCodeForLang(lang)} w-5 h-3.5`}></span>
	              <span className="text-gray-300">{LABELS[lang] ?? langLabel(lang)}</span>
	            </label>
	          ))}

								<div className="mt-2 flex justify-end gap-2 px-2">
									<button className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600" onClick={() => setOpen(false)}>Cancel</button>
									<button className="text-xs px-2 py-1 rounded bg-sky-600 hover:bg-sky-500" onClick={apply}>Apply</button>
								</div>
	        </div>
	      )}
	    </div>
	  );
}
