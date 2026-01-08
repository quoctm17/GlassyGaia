import { useRef, useState } from "react";
import PortalDropdown from "./PortalDropdown";
import { ChevronDown } from "lucide-react";
import "../styles/components/content-type-selector.css";

type GroupMode = 'level' | 'contentType';

interface Props {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
  className?: string;
}

export default function GroupModeSelector({ 
  value, 
  onChange, 
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

  const options: Array<{ value: GroupMode; label: string }> = [
    { value: 'level', label: 'Level' },
    { value: 'contentType', label: 'Content Type' }
  ];

  return (
    <div style={{ position: 'relative' }} className={className || ""}>
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
        <span>{options.find(opt => opt.value === value)?.label || 'Level'}</span>
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
          <div className="language-options-header">Group By</div>
          <div className="language-options-list">
            {options.map((option) => {
              const active = value === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    handleClose();
                  }}
                  className={`language-option ${active ? 'active' : ''}`}
                >
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}

