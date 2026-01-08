import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Calendar, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import DualRangeSlider from './DualRangeSlider';
import SingleRangeSlider from './SingleRangeSlider';
import { apiFetchCardsForFilm, apiListEpisodes, apiToggleSaveCard } from '../services/cfApi';
import type { CardDoc } from '../types';
import type { EpisodeMetaApi } from '../services/cfApi';
import { useUser } from '../context/UserContext';
import { subtitleText } from '../utils/subtitles';
import { calculateTextLength } from '../utils/lang';
import '../styles/components/content-type-grid-filter-modal.css';

interface ContentTypeGridSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (filters: any) => void;
  filmId: string | null;
  allItems?: Array<{
    id: string;
    num_cards?: number | null;
  }>;
}

function ContentTypeGridSaveModal({
  isOpen,
  onClose,
  onSave,
  filmId
}: ContentTypeGridSaveModalProps) {
  const { user, preferences } = useUser();
  const [selectedLevels, setSelectedLevels] = useState<Set<string>>(new Set());
  const [minLength, setMinLength] = useState<number>(1);
  const [maxLength, setMaxLength] = useState<number>(100);
  const [maxDuration, setMaxDuration] = useState<number>(120);
  const [minReview, setMinReview] = useState<number>(1);
  const [maxReview, setMaxReview] = useState<number>(1000);
  
  // Episode and cards state
  const [episodes, setEpisodes] = useState<EpisodeMetaApi[]>([]);
  const [selectedEpisodeSlug, setSelectedEpisodeSlug] = useState<string | null>(null);
  const [allCards, setAllCards] = useState<CardDoc[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Calculate max duration from cards (must be after allCards declaration)
  const maxCardDuration = useMemo(() => {
    if (allCards.length === 0) return 120; // Default fallback
    const durations = allCards.map(card => card.duration || (card.end - card.start) || 0);
    const maxDuration = Math.max(...durations);
    // Use actual max duration from cards, minimum 1 second
    return Math.max(maxDuration, 1);
  }, [allCards]);

  // Load episodes when filmId changes
  useEffect(() => {
    if (!isOpen || !filmId) {
      setEpisodes([]);
      setSelectedEpisodeSlug(null);
      setAllCards([]);
      setSelectedCardIds(new Set());
      return;
    }

    const loadEpisodes = async () => {
      try {
        const episodesList = await apiListEpisodes(filmId);
        setEpisodes(episodesList);
        if (episodesList.length > 0) {
          setSelectedEpisodeSlug(episodesList[0].slug);
        }
      } catch (error) {
        console.error('Failed to load episodes:', error);
        setEpisodes([]);
      }
    };

    loadEpisodes();
  }, [isOpen, filmId]);

  // Load cards when episode changes
  useEffect(() => {
    if (!isOpen || !filmId || !selectedEpisodeSlug) {
        setAllCards([]);
        setSelectedCardIds(new Set());
      return;
    }

    const loadCards = async () => {
      setLoadingCards(true);
      try {
        // Load all cards from the selected episode
        let allEpisodeCards: CardDoc[] = [];
        let startFrom = 0;
        const batchSize = 200;
        
        while (true) {
          // Pass userId to exclude saved cards at query level
          const batch = await apiFetchCardsForFilm(
            filmId, 
            selectedEpisodeSlug, 
            batchSize, 
            { 
              startFrom,
              excludeSavedForUser: user?.uid || undefined
            }
          );
          if (batch.length === 0) break;
          
          allEpisodeCards = [...allEpisodeCards, ...batch];
          
          if (batch.length < batchSize) break;
          
          const lastCard = batch[batch.length - 1];
          startFrom = Math.floor(lastCard.end) + 1;
        }
        
        // Cards are already filtered at backend level - no need to check save status
        console.log(`[ContentTypeGridSaveModal] Loaded ${allEpisodeCards.length} unsaved cards for episode ${selectedEpisodeSlug}`);
        
        setAllCards(allEpisodeCards);
      } catch (error) {
        console.error('Failed to load cards:', error);
        setAllCards([]);
      } finally {
        setLoadingCards(false);
      }
    };

    loadCards();
  }, [isOpen, filmId, selectedEpisodeSlug, user?.uid]);

  // Update maxDuration when cards load (set to max card duration)
  // Reset maxDuration when episode changes or cards are reloaded
  const prevEpisodeRef = useRef<string | null>(null);
  const prevMaxCardDurationRef = useRef<number>(0);
  useEffect(() => {
    if (allCards.length > 0 && maxCardDuration > 0) {
      // If episode changed or first load, reset maxDuration to maxCardDuration
      if (prevEpisodeRef.current !== selectedEpisodeSlug) {
        setMaxDuration(maxCardDuration);
        prevEpisodeRef.current = selectedEpisodeSlug;
        prevMaxCardDurationRef.current = maxCardDuration;
      }
      // Also update if maxCardDuration changed (e.g., when cards finish loading and calculating max)
      else if (prevMaxCardDurationRef.current !== maxCardDuration) {
        setMaxDuration(maxCardDuration);
        prevMaxCardDurationRef.current = maxCardDuration;
      }
    } else if (!selectedEpisodeSlug) {
      // Reset when episode is cleared
      prevEpisodeRef.current = null;
      prevMaxCardDurationRef.current = 0;
      setMaxDuration(120);
    }
  }, [allCards.length, maxCardDuration, selectedEpisodeSlug]);

  // Get unique levels from cards
  const availableLevels = useMemo(() => {
    const levelsSet = new Set<string>();
    allCards.forEach(card => {
      if (card.levels && Array.isArray(card.levels)) {
        card.levels.forEach(level => {
          if (level.level) {
            levelsSet.add(level.level.toUpperCase());
          }
        });
      }
    });
    
    // Sort levels
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
    
    Array.from(levelsSet).sort().forEach(level => sorted.push(level));
    
    // Add 'Unknown' if there are cards without levels
    const hasCardsWithoutLevel = allCards.some(card => 
      !card.levels || card.levels.length === 0
    );
    if (hasCardsWithoutLevel && !sorted.includes('Unknown')) {
      sorted.push('Unknown');
    }
    
    return sorted;
  }, [allCards]);

  // Helper to get word count from card subtitle
  const getCardWordCount = useCallback((card: CardDoc): number => {
    const mainLang = preferences?.main_language || 'en';
    // Try to get subtitle text from main language
    const subtitle = subtitleText(card, mainLang);
    if (subtitle) {
      return calculateTextLength(subtitle, mainLang);
    }
    
    // Fallback to sentence
    if (card.sentence) {
      return calculateTextLength(card.sentence, mainLang);
    }
    
    // Fallback to any available subtitle
    if (card.subtitle && Object.keys(card.subtitle).length > 0) {
      const firstLang = Object.keys(card.subtitle)[0];
      const firstSubtitle = card.subtitle[firstLang];
      if (firstSubtitle) {
        return calculateTextLength(firstSubtitle, firstLang);
      }
    }
    
    return 0;
  }, [preferences?.main_language]);

  // Filter cards based on LEVEL, DURATION, and NUMBER OF WORDS filters
  const filteredCards = useMemo(() => {
    let result = allCards;

    // Level filter
    if (selectedLevels.size > 0) {
      result = result.filter(card => {
        if (!card.levels || card.levels.length === 0) {
          return selectedLevels.has('Unknown');
        }
        return card.levels.some(level => 
          selectedLevels.has(level.level.toUpperCase())
        );
      });
    }

    // Number of words filter
    if (minLength > 1 || maxLength < 100) {
      result = result.filter(card => {
        const wordCount = getCardWordCount(card);
        return wordCount >= minLength && wordCount <= maxLength;
      });
    }

    // Duration filter
    if (maxDuration < maxCardDuration) {
      result = result.filter(card => {
        const duration = card.duration || (card.end - card.start);
        return duration <= maxDuration;
      });
    }

    return result;
  }, [allCards, selectedLevels, minLength, maxLength, maxDuration, maxCardDuration, getCardWordCount]);

  // Determine which cards to show in preview
  // If LEVEL, DURATION, or NUMBER OF WORDS filter is active, show filtered cards, otherwise show all cards
  const previewCards = useMemo(() => {
    const hasActiveFilters = selectedLevels.size > 0 || maxDuration < maxCardDuration || minLength > 1 || maxLength < 100;
    return hasActiveFilters ? filteredCards : allCards;
  }, [filteredCards, allCards, selectedLevels.size, maxDuration, maxCardDuration, minLength, maxLength]);

  // Auto-select cards when filters or cards change
  useEffect(() => {
    const hasActiveFilters = selectedLevels.size > 0 || maxDuration < maxCardDuration || minLength > 1 || maxLength < 100;
    
    if (hasActiveFilters) {
      // When filters are active, select only filtered cards
      if (filteredCards.length > 0) {
        setSelectedCardIds(new Set(filteredCards.map(card => card.id)));
      } else {
        setSelectedCardIds(new Set());
      }
    } else {
      // When no filters, select all cards of the episode (already filtered out saved ones)
      if (allCards.length > 0) {
        setSelectedCardIds(new Set(allCards.map(card => card.id)));
      } else {
        setSelectedCardIds(new Set());
      }
    }
  }, [filteredCards, allCards, selectedLevels, maxDuration, maxCardDuration, minLength, maxLength]);

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
    setMaxDuration(maxCardDuration);
    setMinReview(1);
    setMaxReview(1000);
    // Don't clear selected cards, keep current selection
  }, [maxCardDuration]);

  const toggleLevel = (level: string) => {
    setSelectedLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const toggleCard = (cardId: string) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  // Check if all preview cards are selected
  const allPreviewSelected = useMemo(() => {
    if (previewCards.length === 0) return false;
    return previewCards.every(card => selectedCardIds.has(card.id));
  }, [previewCards, selectedCardIds]);

  const handleToggleSelectAll = () => {
    if (allPreviewSelected) {
      // Unselect all
      setSelectedCardIds(new Set());
    } else {
      // Select all preview cards
      if (previewCards.length > 0) {
        setSelectedCardIds(new Set(previewCards.map(card => card.id)));
      }
    }
  };

  const handleSave = useCallback(async () => {
    if (!user?.uid || !filmId || !selectedEpisodeSlug || selectedCardIds.size === 0) return;

    setSaving(true);
    try {
      // Save each selected card
      let successCount = 0;
      let failCount = 0;
      
      const savePromises = Array.from(selectedCardIds).map(async (cardId) => {
        const card = allCards.find(c => c.id === cardId);
        if (!card) return;

        const episodeId = card.episode_id || selectedEpisodeSlug;

        try {
          await apiToggleSaveCard(
            user.uid,
            cardId,
            filmId,
            episodeId
          );
          successCount++;
        } catch (error) {
          console.error(`Failed to save card ${cardId}:`, error);
          failCount++;
        }
      });

      await Promise.all(savePromises);
      
      // Show toast notification
      if (successCount > 0) {
        toast.success(`Successfully saved ${successCount} card${successCount > 1 ? 's' : ''}`);
      }
      if (failCount > 0) {
        toast.error(`Failed to save ${failCount} card${failCount > 1 ? 's' : ''}`);
      }
      
      // Remove saved cards from allCards state
      setAllCards(prev => prev.filter(card => !selectedCardIds.has(card.id)));
      
      // Clear selected cards
      setSelectedCardIds(new Set());
      
      onSave({
        levels: selectedLevels.size > 0 ? Array.from(selectedLevels) : undefined,
        minLength,
        maxLength,
        maxDuration,
        minReview,
        maxReview,
      });
      
      // Don't close modal immediately, let user see the result
      // onClose();
    } catch (error) {
      console.error('Failed to save cards:', error);
      toast.error('Failed to save cards');
    } finally {
      setSaving(false);
    }
  }, [user?.uid, filmId, selectedEpisodeSlug, selectedCardIds, allCards, selectedLevels, minLength, maxLength, maxDuration, minReview, maxReview, onSave]);

  if (!isOpen) return null;

  return (
    <div className="content-type-grid-filter-modal-overlay" onClick={onClose}>
      <div className="content-type-grid-filter-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="content-type-grid-filter-modal-header">
          <div className="content-type-grid-filter-modal-title">
            <img src={saveHeartIcon} alt="Save" className="content-type-grid-filter-modal-icon" />
            <span>SAVE CARDS</span>
          </div>
          <button className="content-type-grid-filter-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className="content-type-grid-filter-modal-body">
          {/* EPISODE SELECTOR Section */}
          {episodes.length > 0 && (
            <div className="content-type-grid-filter-section">
              <div className="content-type-grid-filter-section-header">
                <span className="content-type-grid-filter-section-title">EPISODE</span>
              </div>
              <select
                value={selectedEpisodeSlug || ''}
                onChange={(e) => setSelectedEpisodeSlug(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid #FEE4E4',
                  borderRadius: '8px',
                  background: '#FFFFFF',
                  color: 'var(--text)',
                  fontFamily: 'Noto Sans, sans-serif',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {episodes.map(episode => (
                  <option key={episode.slug} value={episode.slug}>
                    Episode {episode.episode_number} {episode.title ? `- ${episode.title}` : ''} ({episode.num_cards || 0} cards)
                  </option>
                ))}
              </select>
            </div>
          )}

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
                  onClick={() => toggleLevel(level)}
                >
                  <span className={`content-type-grid-filter-option-checkbox ${selectedLevels.has(level) ? 'checked' : ''}`}>
                    {selectedLevels.has(level) && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                  </span>
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* LENGTH Section */}
          <div className="content-type-grid-filter-section">
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

          {/* DURATION Section */}
          <div className="content-type-grid-filter-section">
            <div className="content-type-grid-filter-section-header">
              <Clock className="content-type-grid-filter-section-icon" size={16} color="var(--primary)" />
              <span className="content-type-grid-filter-section-title">DURATION</span>
            </div>
            <div className="content-type-grid-filter-duration-wrapper">
              <SingleRangeSlider
                min={0}
                max={maxCardDuration}
                value={maxDuration}
                onChange={setMaxDuration}
              />
              <div className="content-type-grid-filter-duration-inputs">
                <input
                  type="number"
                  className="content-type-grid-filter-duration-input"
                  value={maxDuration}
                  onChange={(e) => {
                    const val = Math.min(maxCardDuration, Math.max(parseInt(e.target.value) || 0, 0));
                    setMaxDuration(val);
                  }}
                  min={0}
                  max={maxCardDuration}
                  style={{ borderColor: '#FEE4E4', borderRadius: '8px' }}
                />
                <span className="content-type-grid-filter-duration-unit">s</span>
              </div>
            </div>
          </div>

          {/* REVIEW Section */}
          <div className="content-type-grid-filter-section">
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

          {/* PREVIEW Section */}
          {loadingCards ? (
            <div className="content-type-grid-filter-section">
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text)' }}>
                Loading cards...
              </div>
            </div>
          ) : previewCards.length > 0 ? (
            <div className="content-type-grid-filter-section">
              <div className="content-type-grid-filter-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className={`content-type-grid-filter-option-checkbox ${allPreviewSelected ? 'checked' : ''}`}
                    onClick={handleToggleSelectAll}
                    style={{ cursor: 'pointer' }}
                  >
                    {allPreviewSelected && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                  </span>
                  <span className="content-type-grid-filter-section-title">
                    PREVIEW ({selectedCardIds.size} / {previewCards.length} cards selected)
                  </span>
                </div>
              </div>
              <div style={{ 
                maxHeight: '400px', 
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px'
              }}>
                {previewCards.map(card => {
                  const isSelected = selectedCardIds.has(card.id);
                  const mainLang = preferences?.main_language || 'en';
                  const subtitle = subtitleText(card, mainLang) || card.sentence || '';
                  const duration = card.duration || (card.end - card.start);
                  const wordCount = getCardWordCount(card);
                  
                  return (
                    <div
                      key={card.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        backgroundColor: isSelected ? 'var(--hover-bg)' : 'transparent'
                      }}
                      onClick={() => toggleCard(card.id)}
                    >
                      <span className={`content-type-grid-filter-option-checkbox ${isSelected ? 'checked' : ''}`}>
                        {isSelected && <span className="content-type-grid-filter-option-checkmark">✓</span>}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          fontSize: '12px', 
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {subtitle || 'No subtitle'}
                        </div>
                        <div style={{ 
                          fontSize: '10px', 
                          color: 'var(--neutral)',
                          marginTop: '2px'
                        }}>
                          {duration.toFixed(1)}s
                          {wordCount > 0 && (
                            <> • {wordCount} {wordCount === 1 ? 'word' : 'words'}</>
                          )}
                          {card.levels && card.levels.length > 0 && (
                            <> • {card.levels.map(l => l.level).join(', ')}</>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="content-type-grid-filter-section">
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--neutral)' }}>
                {selectedLevels.size > 0 || minLength > 1 || maxLength < 100 || maxDuration < maxCardDuration 
                  ? 'No cards match the selected filters' 
                  : 'No cards available'}
              </div>
            </div>
          )}
        </div>

        <div className="content-type-grid-filter-modal-footer">
          <button className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-clear" onClick={handleClear}>
            CLEAR
          </button>
          <button 
            className="content-type-grid-filter-modal-btn content-type-grid-filter-modal-btn-apply" 
            onClick={handleSave}
            disabled={saving || selectedCardIds.size === 0}
          >
            {saving ? 'SAVING...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ContentTypeGridSaveModal;
