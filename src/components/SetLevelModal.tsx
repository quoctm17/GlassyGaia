import { useCallback, useEffect, useState } from "react";
import settingIcon from "../assets/icons/setting.svg";
import informationIcon from "../assets/icons/information.svg";
import checkIcon from "../assets/icons/check.svg";
import "../styles/components/set-level-modal.css";

interface SetLevelModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLevel: string | null;
  onApply: (minFreq: number | null, maxFreq: number | null) => void;
}

interface LevelBand {
  low: number;
  high: number;
  words: string[];
}

const LEVEL_BANDS: LevelBand[] = [
  { low: 0,     high: 100,   words: ["of", "some", "been", "can", "one", "her", "which", "what"] },
  { low: 100,   high: 200,   words: ["government", "research", "total", "even", "present", "shall", "world", "being"] },
  { low: 200,   high: 400,   words: ["country", "health", "society", "action", "due", "until", "away", "think"] },
  { low: 400,   high: 600,   words: ["materials", "west", "union", "personal", "basis", "considered", "press", "greater"] },
  { low: 600,   high: 900,   words: ["produced", "defendant", "associated", "stock", "primary", "charge", "generally", "capacity"] },
  { low: 900,   high: 1200,  words: ["circumstances", "amendment", "entitled", "improvement", "understanding", "noted", "otherwise", "caused"] },
  { low: 1200,  high: 1600,  words: ["somewhat", "fiscal", "instance", "ordered", "assets", "experimental", "procedures", "branch"] },
  { low: 1600,  high: 2000,  words: ["contrast", "carefully", "cooperation", "grand", "applicable", "numerous", "recognized", "jurisdiction"] },
  { low: 2000,  high: 2500,  words: ["listed", "declared", "export", "mechanism", "copper", "operate", "creek", "temporary"] },
  { low: 2500,  high: 3000,  words: ["integrated", "panel", "acquisition", "vary", "proceeding", "readily", "practically", "tendency"] },
  { low: 3000,  high: 3600,  words: ["optical", "profession", "considerably", "therein", "noble", "imperial", "seriously", "judges"] },
  { low: 3600,  high: 4200,  words: ["magnitude", "heavily", "altogether", "adopt", "lieutenant", "solely", "rehabilitation", "suspended"] },
  { low: 4200,  high: 4900,  words: ["void", "worship", "colonies", "reservoir", "prosecution", "ethical", "reversed", "roughly"] },
  { low: 4900,  high: 5600,  words: ["inevitable", "explicit", "carriage", "indigenous", "refusal", "documentation", "retention", "elastic"] },
  { low: 5600,  high: 6400,  words: ["imprisonment", "eligibility", "pat", "pertinent", "manifest", "dorsal", "cumulative", "spare"] },
  { low: 6400,  high: 7200,  words: ["carbonate", "lasting", "governors", "backed", "revelation", "abstracts", "deprived", "reliance"] },
  { low: 7200,  high: 8100,  words: ["obscure", "indictment", "endless", "deliberate", "sociological", "obey", "differing", "assert"] },
  { low: 8100,  high: 9000,  words: ["privileged", "robust", "caesar", "afterward", "affinity", "durable", "inflammation", "aboard"] },
  { low: 9000,  high: 10000, words: ["memphis", "recess", "capillary", "intra", "forfeiture", "definitive", "plague", "schooling"] },
  { low: 10000, high: 11000, words: ["negligent", "interchange", "radically", "anesthesia", "sanctuary", "righteousness", "reddish", "unilateral"] },
  { low: 11000, high: 13000, words: ["metallurgical", "echoed", "admittedly", "furnishings", "anatomical", "ferrous", "deductible", "fitzgerald"] },
  { low: 13000, high: 15000, words: ["duchess", "aforementioned", "beatrice", "rally", "erotic", "oxidized", "accusations", "annular"] },
  { low: 15000, high: 18000, words: ["quaternary", "modernism", "dearborn", "solicit", "rigidly", "deterrence", "corrugated", "constipation"] },
  { low: 18000, high: 21000, words: ["ail", "hypotension", "spatially", "assorted", "postulate", "tilting", "dogmatic", "calamity"] },
  { low: 21000, high: 25000, words: ["confucius", "tunneling", "occidental", "nonferrous", "predisposition", "fruiting", "emanuel", "stoic"] },
  { low: 25000, high: 29000, words: ["adair", "distally", "blackwood", "opportune", "agglutination", "displeased", "triumphantly", "indisputable"] },
  { low: 29000, high: 34000, words: ["pheromone", "mchenry", "amity", "brotherly", "narcissistic", "bequeath", "varietal", "affront"] },
  { low: 34000, high: 39000, words: ["riveting", "petrographic", "excrement", "septicemia", "reviewable", "stoichiometry", "undaunted", "consulates"] },
  { low: 39000, high: 45000, words: ["rubenstein", "diverticulum", "coalesced", "wince", "loathe", "parenthetically", "backscattering", "wretchedness"] },
  { low: 45000, high: 51000, words: ["imminence", "heeding", "uselessness", "sprains", "vegetal", "atrophied", "stigmata", "militarization"] },
  { low: 51000, high: 58000, words: ["bilious", "haughtily", "throaty", "tellingly", "reflexively", "hypercholesterolemia", "redacted", "convulsively"] },
  { low: 58000, high: 65000, words: ["unicameral", "dressler", "reliquary", "allegan", "selfsame", "disenfranchisement", "penetrance", "imperfective"] },
  { low: 65000, high: 73000, words: ["antiterrorism", "whimsically", "egyptology", "pollinator", "transurethral", "ignominiously", "translatable", "imminently"] },
  { low: 73000, high: 81000, words: ["incongruence", "ulrike", "decerebrate", "grandiosity", "vertiginous", "secularisation", "governmentally", "evisceration"] },
];

/** Format: 1200 → "1.2K", 100 → "100", 2500 → "2.5K" */
function formatRangeLabel(_low: number, high: number): string {
  if (high >= 1000) {
    return `${(high / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(high);
}

/** Find which band index a frequency string belongs to, or -1 if none */
function findActiveIndex(levelStr: string | null): number {
  if (!levelStr) return -1;
  const n = parseInt(levelStr, 10);
  if (isNaN(n)) return -1;
  const idx = LEVEL_BANDS.findIndex((b) => n >= b.low && n < b.high);
  if (idx === -1 && n >= LEVEL_BANDS[LEVEL_BANDS.length - 1].low) {
    return LEVEL_BANDS.length - 1;
  }
  return idx;
}

export default function SetLevelModal({
  isOpen,
  onClose,
  initialLevel,
  onApply,
}: SetLevelModalProps) {
  // Step 1 state: which row is selected (min level)
  const [step1Index, setStep1Index] = useState<number>(() =>
    findActiveIndex(initialLevel)
  );
  // Step 2 state: which row is selected (max level)
  const [step2Index, setStep2Index] = useState<number>(-1);
  // Current step (1 or 2)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Reset all state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep1Index(findActiveIndex(initialLevel));
      setStep2Index(-1);
      setCurrentStep(1);
    }
  }, [isOpen, initialLevel]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Step 1 ──────────────────────────────────────────────
  // Click a row in Step 1 (only selectable if not highest-locked)
  const handleStep1RowClick = useCallback(
    (index: number) => {
      // Prevent selecting the highest band
      if (index === LEVEL_BANDS.length - 1) return;
      // Toggle off if clicking same row
      setStep1Index((prev) => (prev === index ? -1 : index));
      // Clear step 2 when step 1 changes
      setStep2Index(-1);
    },
    []
  );

  // Step 1 Next button — enabled only when a row is selected
  const canGoToStep2 = step1Index >= 0;

  const handleStep1Next = useCallback(() => {
    if (canGoToStep2) setCurrentStep(2);
  }, [canGoToStep2]);

  // ── Step 2 ──────────────────────────────────────────────
  // Click a row in Step 2 (only selectable if above step1)
  const handleStep2RowClick = useCallback(
    (index: number) => {
      if (index <= step1Index) return;
      setStep2Index((prev) => (prev === index ? -1 : index));
    },
    [step1Index]
  );

  // Reset to default (all levels)
  const handleResetDefault = useCallback(() => {
    setStep1Index(-1);
    setStep2Index(-1);
    setCurrentStep(1);
    onApply(null, null);
    onClose();
  }, [onApply, onClose]);

  // Apply: pass min (step1) and max (step2) frequency values
  const handleApply = useCallback(() => {
    if (step1Index >= 0 && step2Index >= 0) {
      onApply(LEVEL_BANDS[step1Index].low, LEVEL_BANDS[step2Index].low);
      onClose();
    }
  }, [step1Index, step2Index, onApply, onClose]);

  if (!isOpen) return null;

  // Determine row classes for each band in each step
  function getRowClasses(index: number): string {
    if (currentStep === 1) {
      // Highest band is always locked
      if (index === LEVEL_BANDS.length - 1) {
        return "setlevel-level-row highest-locked";
      }
      // Step 1 selected
      return `setlevel-level-row${step1Index === index ? " active" : ""}`;
    } else {
      // Step 2
      // Step 1 confirmed selection — keep active style (dot + colors preserved)
      if (index === step1Index) {
        return "setlevel-level-row step1-selection";
      }
      // Below step1 selection → locked (muted, no dot)
      if (index < step1Index) {
        return "setlevel-level-row step2-locked";
      }
      // Between min and max (exclusive) → words use active-word-color, label muted
      if (index > step1Index && index < step2Index) {
        return "setlevel-level-row step2-within";
      }
      // Step 2 selected (max) → step2 active color CD285B
      return `setlevel-level-row${step2Index === index ? " step2-active" : ""}`;
    }
  }

  return (
    <div className="setlevel-overlay" onClick={onClose}>
      <div
        className="setlevel-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Set Language Level"
      >
        {/* Header */}
        <div className="setlevel-header">
          <div className="setlevel-header-left">
            <img
              src={settingIcon}
              alt=""
              className="setlevel-header-icon"
              aria-hidden="true"
            />
            <span className="setlevel-title">SET LANGUAGE LEVEL</span>
            <img
              src={informationIcon}
              alt="More information"
              className="setlevel-tooltip-icon"
              title="The frequency range tells you how common a word is — lower ranges contain simpler, more common words."
              aria-hidden="true"
            />
          </div>
          <div className="setlevel-header-right">
            <button
              className="setlevel-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="setlevel-body">
          {/* Step Row */}
          <div className="setlevel-step-row">
            <span className="setlevel-step-emoji" aria-hidden="true">
              🎯
            </span>
            <span className="setlevel-step-text typography-noto-14-sb">
              {currentStep === 1
                ? "Step 1: Pick the level that feels just right for you"
                : "Step 2: Now pick one that makes you think, \u201cHmm\u2026 this is tricky!\u201d"}
            </span>
          </div>

          {/* Level Bands */}
          <div
            className="setlevel-level-list"
            role="listbox"
            aria-label="Frequency range — select one"
          >
            {LEVEL_BANDS.map((band, index) => {
              const rowClasses = getRowClasses(index);
              const isClickable =
                currentStep === 1
                  ? index !== LEVEL_BANDS.length - 1 // step 1: all except highest
                  : index > step1Index; // step 2: only above step1

              return (
                <div
                  key={band.low}
                  className={rowClasses}
                  role="option"
                  aria-selected={
                    currentStep === 1
                      ? step1Index === index
                      : step2Index === index
                  }
                  onClick={() =>
                    isClickable
                      ? currentStep === 1
                        ? handleStep1RowClick(index)
                        : handleStep2RowClick(index)
                      : undefined
                  }
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (!isClickable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (currentStep === 1) {
                        handleStep1RowClick(index);
                      } else {
                        handleStep2RowClick(index);
                      }
                    }
                  }}
                >
                  {/* Left: frequency range label */}
                  <div className="setlevel-level-label typography-pressstart-6">
                    {formatRangeLabel(band.low, band.high)}
                  </div>

                  {/* Right: sample words + divider */}
                  <div className="setlevel-level-words">
                    <div className="setlevel-words-row typography-noto-13-sb">
                      {band.words.join(", ")}
                    </div>
                    <div className="setlevel-divider" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="setlevel-footer">
          <button
            className="setlevel-reset-btn typography-noto-13-sb"
            type="button"
            onClick={handleResetDefault}
          >
            Default (All Levels)
          </button>
          <button
            className="setlevel-next-btn"
            type="button"
            disabled={currentStep === 1 ? !canGoToStep2 : step2Index < 0}
            onClick={currentStep === 1 ? handleStep1Next : handleApply}
          >
            <img
              src={checkIcon}
              alt=""
              className="setlevel-next-icon"
              aria-hidden="true"
            />
            <span className="setlevel-next-text">
              {currentStep === 1 ? "Next" : "Set Level"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
