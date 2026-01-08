import { useEffect, useState, useCallback, useMemo } from 'react';
import { Calendar, Clock, Tag } from 'lucide-react';
import filterIcon from '../assets/icons/filter.svg';
import DualRangeSlider from './DualRangeSlider';
import SingleRangeSlider from './SingleRangeSlider';
import { langLabel, getFlagImageForLang } from '../utils/lang';
import '../styles/components/content-type-grid-filter-modal.css';
import type { Category } from '../types';
import type { ContentType } from '../types/content';

interface ContentTypeGridFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: ContentFilters) => void;
  allItems: Array<{
    id: string;
    categories?: Category[];
    type?: string;
    num_cards?: number | null;
    available_subs?: string[];
  }>;
}

export interface ContentFilters {
  levels?: string[]; // Array of level strings (N5, N4, A1, etc.)
  minLength?: number;
  maxLength?: number;
  maxDuration?: number; // in seconds
  minReview?: number;
  maxReview?: number;
  categories?: string[]; // category IDs
  mediaTypes?: ContentType[]; // Array of media types
  languageAvailable?: string[]; // Array of language codes - content must have ALL selected languages
}

function ContentTypeGridFilterModal({
  isOpen,
  onClose,
  onApply,
  allItems
}: ContentTypeGridFilterModalProps) {
  const [selectedLevels, setSelectedLevels] = useState<Set<string>>(new Set());
  const [minLength, setMinLength] = useState<number>(1);
  const [maxLength, setMaxLength] = useState<number>(100);
  const [maxDuration, setMaxDuration] = useState<number>(120);
  const [minReview, setMinReview] = useState<number>(1);
  const [maxReview, setMaxReview] = useState<number>(1000);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedMediaTypes, setSelectedMediaTypes] = useState<Set<ContentType>>(new Set());
  const [selectedLanguages, setSelectedLanguages] = useState<Set<string>>(new Set());

  // Get unique categories from all items
  const availableCategories = Array.from(
    new Map(
      allItems
        .flatMap(item => item.categories || [])
        .map(cat => [cat.id, cat])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Get unique languages from all items
  const availableLanguages = Array.from(
    new Set(
      allItems.flatMap(item => item.available_subs || [])
    )
  ).sort();

  // Get unique media types
  const availableMediaTypes: ContentType[] = ['movie', 'series', 'video', 'book'];
  
  // Get all available levels from items
  const availableLevels = useMemo(() => {
    const levelsSet = new Set<string>();
    allItems.forEach(item => {
      // Parse level_framework_stats to get all levels
      let stats: any = null;
      const itemWithStats = item as any;
      if (itemWithStats.level_framework_stats) {
        if (Array.isArray(itemWithStats.level_framework_stats)) {
          stats = itemWithStats.level_framework_stats;
        } else if (typeof itemWithStats.level_framework_stats === 'string') {
          try {
            stats = JSON.parse(itemWithStats.level_framework_stats);
          } catch {}
        }
      }
      
      if (stats && Array.isArray(stats)) {
        stats.forEach((entry: any) => {
          if (entry.levels && typeof entry.levels === 'object') {
            Object.keys(entry.levels).forEach(level => {
              levelsSet.add(level.toUpperCase());
            });
          }
        });
      }
    });
    
    // Sort levels by framework order
    const jlptOrder = ['N5', 'N4', 'N3', 'N2', 'N1'];
    const cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const hskOrder = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7', 'HSK8', 'HSK9'];
    
    const sorted: string[] = [];
    [...jlptOrder, ...cefrOrder, ...hskOrder].forEach(level => {
      if (levelsSet.has(level)) {
        sorted.push(level);
        levelsSet.delete(level);
      }
    });
    
    // Add remaining levels
    Array.from(levelsSet).sort().forEach(level => sorted.push(level));
    
    // Check if there are any items without levels
    const hasItemsWithoutLevel = allItems.some(item => {
      const itemWithStats = item as any;
      if (!itemWithStats.level_framework_stats) return true;
      let stats: any = null;
      if (Array.isArray(itemWithStats.level_framework_stats)) {
        stats = itemWithStats.level_framework_stats;
      } else if (typeof itemWithStats.level_framework_stats === 'string') {
        try {
          stats = JSON.parse(itemWithStats.level_framework_stats);
        } catch {}
      }
      if (!stats || !Array.isArray(stats) || stats.length === 0) return true;
      return false;
    });
    
    // Add 'Unknown' if there are items without levels
    if (hasItemsWithoutLevel && !sorted.includes('Unknown')) {
      sorted.push('Unknown');
    }
    
    return sorted;
  }, [allItems]);

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

  const handleClear = useCallback(() => {
    setSelectedLevels(new Set());
    setMinLength(1);
    setMaxLength(100);
    setMaxDuration(120);
    setMinReview(1);
    setMaxReview(1000);
    setSelectedCategories(new Set());
    setSelectedMediaTypes(new Set());
    setSelectedLanguages(new Set());
  }, []);

  const handleApply = useCallback(() => {
    onApply({
      levels: selectedLevels.size > 0 ? Array.from(selectedLevels) : undefined,
      minLength,
      maxLength,
      maxDuration,
      minReview,
      maxReview,
      categories: selectedCategories.size > 0 ? Array.from(selectedCategories) : undefined,
      mediaTypes: selectedMediaTypes.size > 0 ? Array.from(selectedMediaTypes) : undefined,
      languageAvailable: selectedLanguages.size > 0 ? Array.from(selectedLanguages) : undefined,
    });
    onClose();
  }, [selectedLevels, minLength, maxLength, maxDuration, minReview, maxReview, selectedCategories, selectedMediaTypes, selectedLanguages, onApply, onClose]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

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
          {/* LEVEL Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Calendar className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">LEVEL</span>
            </div>
            <div className="content-type-grid-filter-options-group">
              {availableLevels.map(level => (
                <button
                  key={level}
                  type="button"
                  className={`content-type-grid-filter-option-btn ${selectedLevels.has(level) ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedLevels(prev => {
                      const next = new Set(prev);
                      if (next.has(level)) {
                        next.delete(level);
                      } else {
                        next.add(level);
                      }
                      return next;
                    });
                  }}
                >
                  <span className={`content-type-grid-filter-option-checkbox ${selectedLevels.has(level) ? 'checked' : ''}`}>
                    {selectedLevels.has(level) && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                  </span>
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* LENGTH Section - Hidden for now */}
          <div className="content-type-grid-filter-section" style={{ display: 'none' }}>
            <div className="content-type-grid-filter-section-header">
              <Calendar className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">LENGTH</span>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Number of words</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={minLength}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(parseInt(e.target.value) || 1, maxLength));
                    setMinLength(val);
                  }}
                  min={1}
                  max={100}
                />
                <span className="content-type-grid-filter-range-separator">-</span>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={maxLength}
                  onChange={(e) => {
                    const val = Math.min(100, Math.max(parseInt(e.target.value) || 100, minLength));
                    setMaxLength(val);
                  }}
                  min={1}
                  max={100}
                />
              </div>
            </div>
            <DualRangeSlider
              min={1}
              max={100}
              minValue={minLength}
              maxValue={maxLength}
              onMinChange={setMinLength}
              onMaxChange={setMaxLength}
            />
          </div>

          {/* DURATION Section - Hidden for now */}
          <div className="content-type-grid-filter-section" style={{ display: 'none' }}>
            <div className="content-type-grid-filter-section-header">
              <Clock className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">DURATION</span>
            </div>
            <div className="content-type-grid-filter-duration-wrapper">
              <SingleRangeSlider
                min={0}
                max={600}
                value={maxDuration}
                onChange={setMaxDuration}
              />
              <div className="content-type-grid-filter-duration-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-duration-input"
                  value={maxDuration}
                  onChange={(e) => {
                    const val = Math.min(600, Math.max(parseInt(e.target.value) || 0, 0));
                    setMaxDuration(val);
                  }}
                  min={0}
                  max={600}
                  style={{ borderColor: '#FEE4E4', borderRadius: '8px' }}
                />
                <span className="content-type-grid-filter-duration-unit">s</span>
              </div>
            </div>
          </div>

          {/* REVIEW Section - Hidden for now */}
          <div className="content-type-grid-filter-section" style={{ display: 'none' }}>
            <div className="content-type-grid-filter-section-header">
              <Calendar className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">Review</span>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper">
              <span className="content-type-grid-filter-length-label">Review Counts</span>
              <div className="content-type-grid-filter-range-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={minReview}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(parseInt(e.target.value) || 1, maxReview));
                    setMinReview(val);
                  }}
                  min={1}
                  max={1000}
                />
                <span className="content-type-grid-filter-range-separator">-</span>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={maxReview}
                  onChange={(e) => {
                    const val = Math.min(1000, Math.max(parseInt(e.target.value) || 1000, minReview));
                    setMaxReview(val);
                  }}
                  min={1}
                  max={1000}
                />
              </div>
            </div>
            <DualRangeSlider
              min={1}
              max={1000}
              minValue={minReview}
              maxValue={maxReview}
              onMinChange={setMinReview}
              onMaxChange={setMaxReview}
            />
          </div>

          {/* CATEGORIES Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Tag className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">CATEGORIES</span>
            </div>
            <div className="content-type-grid-filter-options-group">
              {availableCategories.map(category => (
                <button
                  key={category.id}
                  type="button"
                  className={`content-type-grid-filter-option-btn ${selectedCategories.has(category.id) ? 'selected' : ''}`}
                  onClick={() => toggleCategory(category.id)}
                >
                  <span className={`content-type-grid-filter-option-checkbox ${selectedCategories.has(category.id) ? 'checked' : ''}`}>
                    {selectedCategories.has(category.id) && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                  </span>
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {/* Media Type Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Tag className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">Media Type</span>
            </div>
            <div className="content-type-grid-filter-options-group">
              {availableMediaTypes.map(type => (
                <button
                  key={type}
                  type="button"
                  className={`content-type-grid-filter-option-btn ${selectedMediaTypes.has(type) ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedMediaTypes(prev => {
                      const next = new Set(prev);
                      if (next.has(type)) {
                        next.delete(type);
                      } else {
                        next.add(type);
                      }
                      return next;
                    });
                  }}
                >
                  <span className={`content-type-grid-filter-option-checkbox ${selectedMediaTypes.has(type) ? 'checked' : ''}`}>
                    {selectedMediaTypes.has(type) && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                  </span>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Language Available Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Tag className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">Language Available</span>
            </div>
            <div className="content-type-grid-filter-options-group">
              {availableLanguages.map(lang => {
                const flagUrl = getFlagImageForLang(lang);
                const langName = langLabel(lang);
                const isSelected = selectedLanguages.has(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    className={`content-type-grid-filter-option-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedLanguages(prev => {
                        const next = new Set(prev);
                        if (next.has(lang)) {
                          next.delete(lang);
                        } else {
                          next.add(lang);
                        }
                        return next;
                      });
                    }}
                  >
                    <span className={`content-type-grid-filter-option-checkbox ${isSelected ? 'checked' : ''}`}>
                      {isSelected && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                    </span>
                    <img src={flagUrl} alt={`${lang} flag`} className="content-type-grid-filter-language-flag" />
                    <span>{langName}</span>
                  </button>
                );
              })}
            </div>
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

export default ContentTypeGridFilterModal;

