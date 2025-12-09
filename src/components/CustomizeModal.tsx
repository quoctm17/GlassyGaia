import { useEffect } from 'react';
import customIcon from '../assets/icons/custom.svg';
import '../styles/components/customize-modal.css';

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
  volume = 80,
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
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number(e.target.value);
    if (onVolumeChange) {
      onVolumeChange(newVolume);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="customize-modal-title">
            <img src={customIcon} alt="Customize" className="modal-icon" style={{ filter: 'var(--icon-hover-select-filter)' }} />
            <span>CUSTOMIZE</span>
          </h2>
          <button 
            className="customize-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-header">
              <span className="modal-section-icon">🔊</span>
              <h3 className="modal-section-title">VOLUME</h3>
            </div>
            <div className="volume-control">
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                className="volume-slider"
              />
              <span className="volume-value">{volume}%</span>
            </div>
          </div>

          <div className="modal-divider"></div>

          <div className="modal-section">
            <div className="modal-section-header">
              <span className="modal-section-icon">📐</span>
              <h3 className="modal-section-title">LAYOUT</h3>
            </div>
            <div className="layout-control">
              <button
                className={`layout-btn ${resultLayout === 'default' ? 'active' : ''}`}
                onClick={() => onLayoutChange?.('default')}
              >
                <span className="layout-icon">☰</span>
                <span>Default</span>
              </button>
              <button
                className={`layout-btn ${resultLayout === '1-column' ? 'active' : ''}`}
                onClick={() => onLayoutChange?.('1-column')}
              >
                <span className="layout-icon">▐</span>
                <span>1 Column</span>
              </button>
              <button
                className={`layout-btn ${resultLayout === '2-column' ? 'active' : ''}`}
                onClick={() => onLayoutChange?.('2-column')}
              >
                <span className="layout-icon">▐▐</span>
                <span>2 Columns</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button 
            className="modal-btn modal-btn-secondary"
            onClick={() => {
              if (onVolumeChange) onVolumeChange(80);
              if (onLayoutChange) onLayoutChange('default');
            }}
          >
            RESET
          </button>
          <button 
            className="modal-btn modal-btn-primary"
            onClick={onClose}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}
