import { useEffect } from 'react';
import { Volume2, LayoutGrid, Info } from 'lucide-react';
import customIcon from '../assets/icons/custom.svg';
import SingleRangeSlider from './SingleRangeSlider';
import '../styles/components/content-type-grid-filter-modal.css';

interface CustomizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  resultLayout?: 'default' | '1-column' | '2-column';
  onLayoutChange?: (layout: 'default' | '1-column' | '2-column') => void;
}

export default function CustomizeModal({
  isOpen,
  onClose,
  volume = 28,
  onVolumeChange,
  resultLayout = 'default',
  onLayoutChange
}: CustomizeModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleVolumeChange = (newVolume: number) => {
    if (onVolumeChange) {
      onVolumeChange(newVolume);
    }
  };

  const handleReset = () => {
    if (onVolumeChange) onVolumeChange(28);
    if (onLayoutChange) onLayoutChange('default');
  };

  return (
    <div className="content-type-grid-filter-modal-overlay" onClick={onClose}>
      <div className="content-type-grid-filter-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="content-type-grid-filter-modal-header">
          <div className="content-type-grid-filter-modal-title">
            <img src={customIcon} alt="Customize" className="content-type-grid-filter-modal-icon" />
            <span>CUSTOMIZE</span>
          </div>
          <button 
            className="content-type-grid-filter-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="content-type-grid-filter-modal-body">
          {/* VOLUME Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Volume2 className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">VOLUME</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Adjust the audio volume (0-100%)
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Volume Level</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={volume}
                  onChange={(e) => {
                    const val = Math.min(100, Math.max(parseInt(e.target.value) || 0, 0));
                    handleVolumeChange(val);
                  }}
                  min={0}
                  max={100}
                />
                <span style={{ fontFamily: 'Press Start 2P', fontSize: '12px', color: 'var(--primary)' }}>%</span>
              </div>
            </div>
            <SingleRangeSlider
              min={0}
              max={100}
              value={volume}
              onChange={handleVolumeChange}
            />
          </div>

          {/* LAYOUT Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <LayoutGrid className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">LAYOUT</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Choose the display layout for search results
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-options-group">
              <button
                type="button"
                className={`content-type-grid-filter-option-btn ${resultLayout === 'default' ? 'selected' : ''}`}
                onClick={() => onLayoutChange?.('default')}
              >
                <span className={`content-type-grid-filter-option-checkbox ${resultLayout === 'default' ? 'checked' : ''}`}>
                  {resultLayout === 'default' && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                </span>
                Default
              </button>
              <button
                type="button"
                className={`content-type-grid-filter-option-btn ${resultLayout === '1-column' ? 'selected' : ''}`}
                onClick={() => onLayoutChange?.('1-column')}
              >
                <span className={`content-type-grid-filter-option-checkbox ${resultLayout === '1-column' ? 'checked' : ''}`}>
                  {resultLayout === '1-column' && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                </span>
                1 Column
              </button>
              <button
                type="button"
                className={`content-type-grid-filter-option-btn ${resultLayout === '2-column' ? 'selected' : ''}`}
                onClick={() => onLayoutChange?.('2-column')}
              >
                <span className={`content-type-grid-filter-option-checkbox ${resultLayout === '2-column' ? 'checked' : ''}`}>
                  {resultLayout === '2-column' && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                </span>
                2 Columns
              </button>
            </div>
          </div>
        </div>

        <div className="content-type-grid-filter-modal-footer">
          <button 
            className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-clear"
            onClick={handleReset}
          >
            RESET
          </button>
          <button 
            className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-apply"
            onClick={onClose}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}
