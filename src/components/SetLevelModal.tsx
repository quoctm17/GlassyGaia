import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import "../styles/components/content-type-grid-filter-modal.css";

interface SetLevelModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLevel: string | null;
  onApply: (level: string | null) => void;
}

const CEFR_LEVELS: Array<string> = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function SetLevelModal({
  isOpen,
  onClose,
  initialLevel,
  onApply,
}: SetLevelModalProps) {
  const [localLevel, setLocalLevel] = useState<string | null>(initialLevel);

  useEffect(() => {
    setLocalLevel(initialLevel);
  }, [initialLevel]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  const handleApply = useCallback(() => {
    onApply(localLevel);
    onClose();
  }, [localLevel, onApply, onClose]);

  const handleClear = useCallback(() => {
    setLocalLevel(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="content-type-grid-filter-modal-overlay"
      onClick={onClose}
    >
      <div
        className="content-type-grid-filter-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="content-type-grid-filter-modal-header">
          <div className="content-type-grid-filter-modal-title">
            <span>SET LEVEL</span>
          </div>
          <button
            className="content-type-grid-filter-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="content-type-grid-filter-modal-body">
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <span className="content-type-grid-filter-section-title">
                LEVEL FRAMEWORK (CEFR)
              </span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info
                  className="content-type-grid-filter-tooltip-icon"
                  size={14}
                />
                <div className="content-type-grid-filter-tooltip">
                  Choose your preferred difficulty level. Search results will
                  show cards that match this level.
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-section-radio-group">
              <label className="content-type-grid-filter-radio">
                <input
                  type="radio"
                  name="cefr-level"
                  value=""
                  checked={localLevel === null}
                  onChange={() => setLocalLevel(null)}
                />
                <span>All levels</span>
              </label>
              {CEFR_LEVELS.map((lvl) => (
                <label
                  key={lvl}
                  className="content-type-grid-filter-radio"
                >
                  <input
                    type="radio"
                    name="cefr-level"
                    value={lvl}
                    checked={localLevel === lvl}
                    onChange={() => setLocalLevel(lvl)}
                  />
                  <span>{lvl}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="content-type-grid-filter-modal-footer">
          <button
            className="content-type-grid-filter-modal-clear-btn"
            type="button"
            onClick={handleClear}
          >
            Clear
          </button>
          <button
            className="content-type-grid-filter-modal-apply-btn"
            type="button"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

