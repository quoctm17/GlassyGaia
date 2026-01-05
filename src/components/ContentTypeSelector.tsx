import { useRef, useState } from "react";
import PortalDropdown from "./PortalDropdown";
import { ChevronDown } from "lucide-react";
import { CONTENT_TYPE_LABELS, type ContentType } from "../types/content";
import "../styles/components/content-type-selector.css";

interface Props {
  value: ContentType;
  onChange: (type: ContentType) => void;
  options?: ContentType[];
  className?: string;
}

const DEFAULT_OPTIONS: ContentType[] = ['movie', 'series', 'book', 'video'];

export default function ContentTypeSelector({ 
  value, 
  onChange, 
  options = DEFAULT_OPTIONS,
  className 
}: Props) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    if (!closing) {
      setClosing(true);
      setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, 200);
    }
  };

  return (
    <div className={"content-type-selector-container " + (className || "")}>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) {
            handleClose();
          } else {
            setOpen(true);
          }
        }}
        className="content-type-selector-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{CONTENT_TYPE_LABELS[value]}</span>
        <ChevronDown className="content-type-selector-icon" />
      </button>
      {(open || closing) && btnRef.current && (
        <PortalDropdown
          anchorEl={btnRef.current}
          onClose={handleClose}
          align="left"
          offset={4}
          className="language-dropdown"
          durationMs={200}
          closing={closing}
          minWidth={150}
        >
          <div className="language-options-header">Content Type</div>
          <div className="language-options-list">
            {options.map((type) => {
              const active = value === type;
              return (
                <button
                  key={type}
                  onClick={() => {
                    onChange(type);
                    handleClose();
                  }}
                  className={`language-option ${active ? 'active' : ''}`}
                >
                  <span>{CONTENT_TYPE_LABELS[type]}</span>
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}

