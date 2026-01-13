import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Calendar, Tag, Languages, Film, ChevronDown, X, Search, Info, Star } from 'lucide-react';
import filterIcon from '../assets/icons/filter.svg';
import DualRangeSlider from './DualRangeSlider';
import PortalDropdown from './PortalDropdown';
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
  minImdb?: number; // Minimum IMDB score (0-10)
  maxImdb?: number; // Maximum IMDB score (0-10)
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
  const [minImdb, setMinImdb] = useState<number>(0);
  const [maxImdb, setMaxImdb] = useState<number>(10);
  
  // Dropdown states
  const [categoriesDropdownOpen, setCategoriesDropdownOpen] = useState(false);
  const [categoriesDropdownClosing, setCategoriesDropdownClosing] = useState(false);
  const [languagesDropdownOpen, setLanguagesDropdownOpen] = useState(false);
  const [languagesDropdownClosing, setLanguagesDropdownClosing] = useState(false);
  const categoriesBtnRef = useRef<HTMLButtonElement>(null);
  const languagesBtnRef = useRef<HTMLButtonElement>(null);
  const [categoriesSearchQuery, setCategoriesSearchQuery] = useState('');
  const [languagesSearchQuery, setLanguagesSearchQuery] = useState('');

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
    setMinImdb(0);
    setMaxImdb(10);
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
      minImdb: minImdb > 0 ? minImdb : undefined,
      maxImdb: maxImdb < 10 ? maxImdb : undefined,
    });
    onClose();
  }, [selectedLevels, minLength, maxLength, maxDuration, minReview, maxReview, selectedCategories, selectedMediaTypes, selectedLanguages, minImdb, maxImdb, onApply, onClose]);

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

  const toggleLanguage = (lang: string) => {
    setSelectedLanguages(prev => {
      const next = new Set(prev);
      if (next.has(lang)) {
        next.delete(lang);
      } else {
        next.add(lang);
      }
      return next;
    });
  };

  const removeCategory = (categoryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCategories(prev => {
      const next = new Set(prev);
      next.delete(categoryId);
      return next;
    });
  };

  const removeLanguage = (lang: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLanguages(prev => {
      const next = new Set(prev);
      next.delete(lang);
      return next;
    });
  };

  // Filter categories and languages based on search query
  const filteredCategories = useMemo(() => {
    if (!categoriesSearchQuery.trim()) return availableCategories;
    const query = categoriesSearchQuery.toLowerCase();
    return availableCategories.filter(cat => 
      cat.name.toLowerCase().includes(query)
    );
  }, [availableCategories, categoriesSearchQuery]);

  const filteredLanguages = useMemo(() => {
    if (!languagesSearchQuery.trim()) return availableLanguages;
    const query = languagesSearchQuery.toLowerCase();
    return availableLanguages.filter(lang => {
      const label = langLabel(lang).toLowerCase();
      return label.includes(query) || lang.toLowerCase().includes(query);
    });
  }, [availableLanguages, languagesSearchQuery]);

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


          {/* CATEGORIES Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Tag className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">CATEGORIES</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Select one or more categories to filter content
                </div>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <button
                ref={categoriesBtnRef}
                type="button"
                className={`content-type-grid-filter-dropdown-btn ${categoriesDropdownOpen ? 'open' : ''}`}
                onClick={() => {
                  if (categoriesDropdownOpen) {
                    setCategoriesDropdownClosing(true);
                    setTimeout(() => {
                      setCategoriesDropdownOpen(false);
                      setCategoriesDropdownClosing(false);
                    }, 200);
                  } else {
                    setCategoriesDropdownOpen(true);
                  }
                }}
              >
                <div className="content-type-grid-filter-dropdown-input-content">
                  {selectedCategories.size === 0 ? (
                    <span className="content-type-grid-filter-dropdown-placeholder">Select Categories</span>
                  ) : (
                    <div className="content-type-grid-filter-dropdown-tags">
                      {Array.from(selectedCategories).slice(0, 2).map(catId => {
                        const category = availableCategories.find(c => c.id === catId);
                        if (!category) return null;
                        return (
                          <span key={catId} className="content-type-grid-filter-dropdown-tag">
                            {category.name}
                            <span
                              className="content-type-grid-filter-dropdown-tag-remove"
                              onClick={(e) => removeCategory(catId, e)}
                            >
                              <X size={12} />
                            </span>
                          </span>
                        );
                      })}
                      {selectedCategories.size > 2 && (
                        <span className="content-type-grid-filter-dropdown-tag-more">+{selectedCategories.size - 2}...</span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronDown 
                  size={16} 
                  className={`content-type-grid-filter-dropdown-chevron ${categoriesDropdownOpen ? 'open' : ''}`}
                />
              </button>
              {(categoriesDropdownOpen || categoriesDropdownClosing) && categoriesBtnRef.current && (
                <PortalDropdown
                  anchorEl={categoriesBtnRef.current}
                  onClose={() => {
                    if (!categoriesDropdownClosing) {
                      setCategoriesDropdownClosing(true);
                      setTimeout(() => {
                        setCategoriesDropdownOpen(false);
                        setCategoriesDropdownClosing(false);
                        setCategoriesSearchQuery('');
                      }, 200);
                    }
                  }}
                  align="left"
                  offset={8}
                  className="content-type-grid-filter-dropdown-panel"
                  durationMs={200}
                  closing={categoriesDropdownClosing}
                  minWidth={300}
                >
                  <div className="content-type-grid-filter-dropdown-search">
                    <Search size={16} className="content-type-grid-filter-dropdown-search-icon" />
                    <input
                      type="text"
                      placeholder="Search categories..."
                      value={categoriesSearchQuery}
                      onChange={(e) => setCategoriesSearchQuery(e.target.value)}
                      className="content-type-grid-filter-dropdown-search-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="content-type-grid-filter-dropdown-list">
                    {filteredCategories.length === 0 ? (
                      <div className="content-type-grid-filter-dropdown-empty">No categories found</div>
                    ) : (
                      filteredCategories.map(category => {
                        const isSelected = selectedCategories.has(category.id);
                        return (
                          <button
                            key={category.id}
                            type="button"
                            className={`content-type-grid-filter-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => toggleCategory(category.id)}
                          >
                            <span className={`content-type-grid-filter-dropdown-checkbox ${isSelected ? 'checked' : ''}`}>
                              {isSelected && <span className="content-type-grid-filter-dropdown-checkmark">✓</span>}
                            </span>
                            <span>{category.name}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </PortalDropdown>
              )}
            </div>
          </div>

          {/* Language Available Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Languages className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">LANGUAGE AVAILABLE</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Select languages that must be available in the content. Content must have ALL selected languages.
                </div>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <button
                ref={languagesBtnRef}
                type="button"
                className={`content-type-grid-filter-dropdown-btn ${languagesDropdownOpen ? 'open' : ''}`}
                onClick={() => {
                  if (languagesDropdownOpen) {
                    setLanguagesDropdownClosing(true);
                    setTimeout(() => {
                      setLanguagesDropdownOpen(false);
                      setLanguagesDropdownClosing(false);
                    }, 200);
                  } else {
                    setLanguagesDropdownOpen(true);
                  }
                }}
              >
                <div className="content-type-grid-filter-dropdown-input-content">
                  {selectedLanguages.size === 0 ? (
                    <span className="content-type-grid-filter-dropdown-placeholder">Select Languages</span>
                  ) : (
                    <div className="content-type-grid-filter-dropdown-tags">
                      {Array.from(selectedLanguages).slice(0, 2).map(lang => {
                        const flagUrl = getFlagImageForLang(lang);
                        const langName = langLabel(lang);
                        return (
                          <span key={lang} className="content-type-grid-filter-dropdown-tag">
                            <img src={flagUrl} alt={`${lang} flag`} className="content-type-grid-filter-dropdown-tag-flag" />
                            {langName}
                            <button
                              type="button"
                              className="content-type-grid-filter-dropdown-tag-remove"
                              onClick={(e) => removeLanguage(lang, e)}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        );
                      })}
                      {selectedLanguages.size > 2 && (
                        <span className="content-type-grid-filter-dropdown-tag-more">+{selectedLanguages.size - 2}...</span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronDown 
                  size={16} 
                  className={`content-type-grid-filter-dropdown-chevron ${languagesDropdownOpen ? 'open' : ''}`}
                />
              </button>
              {(languagesDropdownOpen || languagesDropdownClosing) && languagesBtnRef.current && (
                <PortalDropdown
                  anchorEl={languagesBtnRef.current}
                  onClose={() => {
                    if (!languagesDropdownClosing) {
                      setLanguagesDropdownClosing(true);
                      setTimeout(() => {
                        setLanguagesDropdownOpen(false);
                        setLanguagesDropdownClosing(false);
                        setLanguagesSearchQuery('');
                      }, 200);
                    }
                  }}
                  align="left"
                  offset={8}
                  className="content-type-grid-filter-dropdown-panel"
                  durationMs={200}
                  closing={languagesDropdownClosing}
                  minWidth={300}
                >
                  <div className="content-type-grid-filter-dropdown-search">
                    <Search size={16} className="content-type-grid-filter-dropdown-search-icon" />
                    <input
                      type="text"
                      placeholder="Search languages..."
                      value={languagesSearchQuery}
                      onChange={(e) => setLanguagesSearchQuery(e.target.value)}
                      className="content-type-grid-filter-dropdown-search-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="content-type-grid-filter-dropdown-list">
                    {filteredLanguages.length === 0 ? (
                      <div className="content-type-grid-filter-dropdown-empty">No languages found</div>
                    ) : (
                      filteredLanguages.map(lang => {
                        const isSelected = selectedLanguages.has(lang);
                        const flagUrl = getFlagImageForLang(lang);
                        const langName = langLabel(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            className={`content-type-grid-filter-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => toggleLanguage(lang)}
                          >
                            <span className={`content-type-grid-filter-dropdown-checkbox ${isSelected ? 'checked' : ''}`}>
                              {isSelected && <span className="content-type-grid-filter-dropdown-checkmark">✓</span>}
                            </span>
                            <img src={flagUrl} alt={`${lang} flag`} className="content-type-grid-filter-dropdown-item-flag" />
                            <span>{langName}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </PortalDropdown>
              )}
            </div>
          </div>

          {/* Media Type Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Film className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">MEDIA TYPE</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Filter content by media type (Movie, Series, Video, Book)
                </div>
              </div>
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

          {/* IMDB Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Star className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">IMDB</span>
              <div className="content-type-grid-filter-tooltip-wrapper">
                <Info className="content-type-grid-filter-tooltip-icon" size={14} />
                <div className="content-type-grid-filter-tooltip">
                  Audience rating on IMDB
                </div>
              </div>
            </div>
            <div className="content-type-grid-filter-range-inputs-wrapper imdb-wrapper">
              <span className="content-type-grid-filter-length-label">Audience rating on IMDB</span>
              <div className="content-type-grid-filter-range-inputs" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={minImdb.toFixed(1)}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(parseFloat(e.target.value) || 0, maxImdb));
                    setMinImdb(val);
                  }}
                  min={0}
                  max={10}
                  step={0.1}
                />
                <span className="content-type-grid-filter-range-separator">-</span>
                <input
                  type="number"
                  className="content-type-grid-filter-range-input"
                  value={maxImdb.toFixed(1)}
                  onChange={(e) => {
                    const val = Math.min(10, Math.max(parseFloat(e.target.value) || 10, minImdb));
                    setMaxImdb(val);
                  }}
                  min={0}
                  max={10}
                  step={0.1}
                />
              </div>
            </div>
            <DualRangeSlider
              min={0}
              max={10}
              minValue={minImdb}
              maxValue={maxImdb}
              onMinChange={setMinImdb}
              onMaxChange={setMaxImdb}
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

export default ContentTypeGridFilterModal;

