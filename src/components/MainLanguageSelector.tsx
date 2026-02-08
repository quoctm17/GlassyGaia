import { useState, useRef } from "react";
import PortalDropdown from "./PortalDropdown";
import { useUser } from "../context/UserContext";
import { langLabel, getFlagImageForLang } from "../utils/lang";
import { ChevronDown } from "lucide-react";
import "../styles/components/language-selectors.css";

interface Props {
  filmId?: string; // optional: fallback to global if not provided
  optionsOverride?: string[]; // explicit list if provided
  className?: string;
  onChange?: (lang: string) => void; // notify parent
}

// FIX: Only English is supported - simplified component
export default function MainLanguageSelector({ filmId: _filmId = "global", optionsOverride: _optionsOverride, className, onChange }: Props) {
  const { preferences, setMainLanguage, openLanguageSelector, setOpenLanguageSelector } = useUser();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const open = openLanguageSelector === "main";
  const [closing, setClosing] = useState(false);

  // Only English is supported - no need to load from API
  const current = preferences.main_language || "en";

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
        <img src={getFlagImageForLang(current)} alt={`${current} flag`} className="w-5 h-3.5 rounded" />
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
          <div className="language-options-header">Language</div>
          <div className="language-options-list">
            <button
              key="en"
              onClick={() => { setMainLanguage("en"); onChange?.("en"); setClosing(true); setTimeout(() => { setOpenLanguageSelector(null); setClosing(false); }, 500); }}
              className="language-option active"
            >
              <img src={getFlagImageForLang("en")} alt="en flag" className="w-5 h-3.5 rounded" />
              <span>English</span>
            </button>
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}
