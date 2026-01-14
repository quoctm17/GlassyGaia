import { useEffect, memo, useCallback, useState } from 'react';
import { Calendar, Clock, MessageSquare, Info } from 'lucide-react';
import filterIcon from '../assets/icons/filter.svg';
import DualRangeSlider from './DualRangeSlider';
import SingleRangeSlider from './SingleRangeSlider';
import '../styles/components/content-type-grid-filter-modal.css';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  minLength: number;
  maxLength: number;
  onLengthChange: (min: number, max: number) => void;
  maxDuration: number;
  onDurationChange: (max: number) => void;
  minReview: number;
  maxReview: number;
  onReviewChange: (min: number, max: number) => void;
}

function FilterModal({
  isOpen,
  onClose,
  minLength,
  maxLength,
  onLengthChange,
  maxDuration,
  onDurationChange,
  minReview,
  maxReview,
  onReviewChange,
}: FilterModalProps) {
  // Local state - only update parent when Apply is clicked
  const [localMinLength, setLocalMinLength] = useState(minLength);
  const [localMaxLength, setLocalMaxLength] = useState(maxLength);
  const [localMaxDuration, setLocalMaxDuration] = useState(maxDuration);
  const [localMinReview, setLocalMinReview] = useState(minReview);
  const [localMaxReview, setLocalMaxReview] = useState(maxReview);

  // Sync with parent (only when modal opens or parent explicitly changes)
  useEffect(() => {
    setLocalMinLength(minLength);
  }, [minLength]);

  useEffect(() => {
    setLocalMaxLength(maxLength);
  }, [maxLength]);

  useEffect(() => {
    setLocalMaxDuration(maxDuration);
  }, [maxDuration]);

  useEffect(() => {
    setLocalMinReview(minReview);
  }, [minReview]);

  useEffect(() => {
    setLocalMaxReview(maxReview);
  }, [maxReview]);

  // Length handlers - only update local state, don't trigger parent
  const handleMinLengthChange = useCallback((value: number) => {
    const newMin = Math.max(1, Math.min(value, localMaxLength));
    setLocalMinLength(newMin);
    // Don't call onLengthChange here - only when Apply is clicked
  }, [localMaxLength]);

  const handleMaxLengthChange = useCallback((value: number) => {
    const newMax = Math.min(1000, Math.max(value, localMinLength));
    setLocalMaxLength(newMax);
    // Don't call onLengthChange here - only when Apply is clicked
  }, [localMinLength]);

  // Duration handler - only update local state, don't trigger parent
  const handleMaxDurationChange = useCallback((value: number) => {
    const newMax = Math.min(300, Math.max(value, 1));
    setLocalMaxDuration(newMax);
    // Don't call onDurationChange here - only when Apply is clicked
  }, []);

  // Review handlers - only update local state, don't trigger parent
  const handleMinReviewChange = useCallback((value: number) => {
    const newMin = Math.max(0, Math.min(value, localMaxReview));
    setLocalMinReview(newMin);
    // Don't call onReviewChange here - only when Apply is clicked
  }, [localMaxReview]);

  const handleMaxReviewChange = useCallback((value: number) => {
    const newMax = Math.min(10000, Math.max(value, localMinReview));
    setLocalMaxReview(newMax);
    // Don't call onReviewChange here - only when Apply is clicked
  }, [localMinReview]);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Clear handler - reset local state only
  const handleClear = useCallback(() => {
    setLocalMinLength(1);
    setLocalMaxLength(100);
    setLocalMaxDuration(120);
    setLocalMinReview(0);
    setLocalMaxReview(1000);
    // Don't trigger parent - user needs to click Apply
  }, []);

  // Apply handler - trigger parent updates and close modal
  const handleApply = useCallback(() => {
    onLengthChange(localMinLength, localMaxLength);
    onDurationChange(localMaxDuration);
    onReviewChange(localMinReview, localMaxReview);
    onClose();
  }, [localMinLength, localMaxLength, localMaxDuration, localMinReview, localMaxReview, onLengthChange, onDurationChange, onReviewChange, onClose]);

  if (!isOpen) return null;

  return (
    <div className="content-type-grid-filter-modal-overlay" onClick={onClose}>
      <div className="content-type-grid-filter-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="content-type-grid-filter-modal-header">
          <div className="content-type-grid-filter-modal-title">
            <img src={filterIcon} alt="Filter" className="content-type-grid-filter-modal-icon" />
            <span>FILTERS</span>
          </div>
          <button className="content-type-grid-filter-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className="content-type-grid-filter-modal-body">
          {/* LENGTH Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Calendar className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">LENGTH</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Filter by number of words in the content
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Number of words</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={localMinLength}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(parseInt(e.target.value) || 1, localMaxLength));
                    handleMinLengthChange(val);
                  }}
                  min={1}
                  max={1000}
                />
                <span className="content-type-grid-filter-range-separator">-</span>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={localMaxLength}
                  onChange={(e) => {
                    const val = Math.min(1000, Math.max(parseInt(e.target.value) || 100, localMinLength));
                    handleMaxLengthChange(val);
                  }}
                  min={1}
                  max={1000}
                />
              </div>
            </div>
            <DualRangeSlider
              min={1}
              max={1000}
              minValue={localMinLength}
              maxValue={localMaxLength}
              onMinChange={handleMinLengthChange}
              onMaxChange={handleMaxLengthChange}
            />
          </div>

          {/* DURATION Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Clock className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">DURATION</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Filter by maximum duration in seconds
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Amount of time</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={localMaxDuration}
                  onChange={(e) => {
                    const val = Math.min(300, Math.max(parseInt(e.target.value) || 1, 1));
                    handleMaxDurationChange(val);
                  }}
                  min={1}
                  max={300}
                />
              </div>
            </div>
            <SingleRangeSlider
              min={1}
              max={300}
              value={localMaxDuration}
              onChange={handleMaxDurationChange}
            />
          </div>

          {/* REVIEW Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <MessageSquare className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">REVIEW</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Filter by review counts
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Review Counts</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={localMinReview}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, localMaxReview));
                    handleMinReviewChange(val);
                  }}
                  min={0}
                  max={10000}
                />
                <span className="content-type-grid-filter-range-separator">-</span>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={localMaxReview}
                  onChange={(e) => {
                    const val = Math.min(10000, Math.max(parseInt(e.target.value) || 1000, localMinReview));
                    handleMaxReviewChange(val);
                  }}
                  min={0}
                  max={10000}
                />
              </div>
            </div>
            <DualRangeSlider
              min={0}
              max={10000}
              minValue={localMinReview}
              maxValue={localMaxReview}
              onMinChange={handleMinReviewChange}
              onMaxChange={handleMaxReviewChange}
            />
          </div>
        </div>

        <div className="content-type-grid-filter-modal-footer">
          <button className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-clear" onClick={handleClear}>
            CLEAR
          </button>
          <button className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-apply" onClick={handleApply}>
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(FilterModal);
