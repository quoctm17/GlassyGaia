import { useState, useRef, useEffect, useCallback } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { apiTrackTime } from '../../services/userTracking';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice/practice-reading.css';
import '../../styles/pages/practice-page.css';

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeReadingProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onCheck: () => void;
}

export default function PracticeReading({ card, onCheck }: PracticeReadingProps) {
  const { user, preferences } = useUser();
  const [userInput, setUserInput] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [checkResult, setCheckResult] = useState<'correct' | 'incorrect' | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mainLang = preferences?.main_language || 'en';
  const hasSubtitleLanguages = preferences?.subtitle_languages && preferences.subtitle_languages.length > 0;
  const subLang = hasSubtitleLanguages ? preferences.subtitle_languages[0] : null;
  const sentence = card.subtitle?.[mainLang] || card.sentence || '';
  
  // Get correct answer (raw text):
  // - If user has selected subtitle languages: use subtitle[sub_language] or card_type (fallback)
  // - If user has NOT selected any subtitle language: use card_type only
  const correctAnswerRaw = hasSubtitleLanguages && subLang && card.subtitle?.[subLang]
    ? card.subtitle[subLang]
    : card.card_type || '';
  
  // Normalize subtitle text for comparison
  // Removes ruby text (brackets), punctuation, normalizes spacing
  // Preserves diacritics (accents) for languages like Vietnamese
  const normalizeSubtitleText = (text: string): string => {
    if (!text) return '';
    
    // Remove ruby text brackets: 贾[jiǎ]斯[sī]汀[tīng] -> 贾斯汀
    let normalized = text.replace(/\[[^\]]+\]/g, '');
    
    // Remove common punctuation marks only (preserve letters with diacritics)
    // Include both ASCII and Unicode punctuation
    normalized = normalized.replace(/[、。．・，,。！!？?：:；;「」『』（）()［］\[\]…—-]/g, '');
    
    // Remove other common punctuation but preserve Unicode letters (including Vietnamese, French, etc.)
    // Use Unicode property escapes to match only punctuation, not letters with diacritics
    normalized = normalized.replace(/[\p{P}\p{S}]/gu, '');
    
    // Normalize whitespace: trim and collapse multiple spaces to single space
    normalized = normalized.trim().replace(/\s+/g, ' ');
    
    // Convert to lowercase for comparison (case-insensitive)
    // This preserves diacritics (á, é, í, ó, ú, ư, etc.)
    normalized = normalized.toLowerCase();
    
    return normalized;
  };
  
  // Normalize correct answer for display and comparison
  const correctAnswer = normalizeSubtitleText(correctAnswerRaw);
  
  // Resolve image URL
  const resolvedImageUrl = (() => {
    if (imageError) return '';
    const base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';
    let url = card.image_url || '';
    if (url && url.startsWith('/') && base) {
      url = `${base}${url}`;
    }
    return url;
  })();

  // Handle image/audio click
  const handleImageClick = () => {
    if (!card.audio_url) return;
    
    if (!audioRef.current) {
      audioRef.current = new Audio(card.audio_url);
      activeAudioInstances.add(audioRef.current);
      
      const handleAudioEnded = () => {
        setIsPlaying(false);
      };
      audioRef.current.addEventListener('ended', handleAudioEnded);
    } else {
      audioRef.current.src = card.audio_url;
    }
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Pause all other audio instances
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audioRef.current) {
          otherAudio.pause();
        }
      });
      audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
      setIsPlaying(true);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        activeAudioInstances.delete(audioRef.current);
      }
    };
  }, []);

  // Track reading time (debounced to avoid too many API calls)
  const readingTimeAccumulatorRef = useRef<number>(0);
  const readingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingStartTimeRef = useRef<number | null>(null);
  
  const handleTrackReading = useCallback((seconds: number) => {
    if (!user?.uid || seconds <= 0) return;
    
    readingTimeAccumulatorRef.current += seconds;
    
    // Debounce: accumulate and send every 8 seconds
    if (readingTimeoutRef.current) {
      clearTimeout(readingTimeoutRef.current);
    }
    
    readingTimeoutRef.current = setTimeout(async () => {
      const totalSeconds = readingTimeAccumulatorRef.current;
      if (totalSeconds > 0 && user?.uid) {
        readingTimeAccumulatorRef.current = 0;
        try {
          await apiTrackTime(user.uid, totalSeconds, 'reading');
        } catch (error) {
          console.error('Failed to track reading time:', error);
        }
      }
    }, 8000);
  }, [user?.uid]);

  // Track reading time when user views the card
  useEffect(() => {
    if (!user?.uid) return;
    
    // Start tracking when component mounts
    readingStartTimeRef.current = Date.now();
    
    // Track time on unmount
    return () => {
      if (readingStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          handleTrackReading(elapsed);
        }
        readingStartTimeRef.current = null;
      }
      if (readingTimeoutRef.current) {
        clearTimeout(readingTimeoutRef.current);
      }
      // Send any remaining accumulated time
      if (readingTimeAccumulatorRef.current > 0 && user?.uid) {
        apiTrackTime(user.uid, readingTimeAccumulatorRef.current, 'reading').catch(() => {});
      }
    };
  }, [card.id, user?.uid, handleTrackReading]);

  // Reset audio and state when card changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setImageError(false);
    setUserInput('');
    setCheckResult(null);
    setHasChecked(false);
    // Reset reading time tracking for new card
    if (readingStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
      if (elapsed > 0 && user?.uid) {
        handleTrackReading(elapsed);
      }
      readingStartTimeRef.current = Date.now();
    }
  }, [card.id, user?.uid, handleTrackReading]);
  
  const handleCheck = () => {
    if (hasChecked) {
      // If already checked, proceed to next card
      onCheck();
      return;
    }
    
    // Normalize user input for comparison
    const normalizedInput = normalizeSubtitleText(userInput);
    
    // Check if answer is correct (correctAnswer is already normalized)
    const isCorrect = normalizedInput === correctAnswer;
    setCheckResult(isCorrect ? 'correct' : 'incorrect');
    setHasChecked(true);
  };

  return (
    <div className="practice-component">
      {/* Image and Sentence Wrapper */}
      <div className="practice-reading-image-sentence-wrapper">
        <div className="practice-image-container">
          {resolvedImageUrl && !imageError ? (
            <>
              <img
                src={resolvedImageUrl}
                alt={card.id}
                className="practice-image"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
                onClick={handleImageClick}
                style={{ cursor: card.audio_url ? 'pointer' : 'default' }}
                onError={() => setImageError(true)}
              />
              {card.audio_url && (
                <div className="practice-image-play-overlay" onClick={handleImageClick}>
                  <img src={buttonPlayIcon} alt="Play" className="practice-play-icon" />
                </div>
              )}
            </>
          ) : (
            <div className="practice-image-placeholder">
              <div className="practice-image-placeholder-text">No Image</div>
            </div>
          )}
        </div>
        <div className="practice-reading-sentence">
          {sentence}
        </div>
      </div>

      {/* Input Section with sentence or Result Section */}
      {!hasChecked ? (
        <div className="practice-input-section">
          <input
            type="text"
            className="practice-input"
            placeholder="Enter the meaning of the sentence"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCheck();
              }
            }}
          />
          <button 
            className="practice-check-btn"
            onClick={handleCheck}
            disabled={!userInput.trim()}
          >
            CHECK
          </button>
        </div>
      ) : (
        <div className={`practice-reading-result-container ${checkResult}`}>
          <div className={`practice-reading-result-header ${checkResult}`}>
            {checkResult === 'correct' ? (
              <>
                <div className="practice-reading-success-icon">
                  <div className="practice-reading-success-icon-check"></div>
                </div>
                <span className="typography-noto-success-text">Great job</span>
              </>
            ) : (
              <>
                <div className="practice-reading-error-icon">
                  <div className="practice-reading-error-icon-x"></div>
                </div>
                <span className="typography-noto-error-text">That's not correct</span>
              </>
            )}
          </div>
          <div className="practice-input-section">
            <div className="practice-reading-result-content">
              <div className="practice-reading-answer">
                <div className="practice-reading-answer-label">Your answer:</div>
                <div className={`practice-reading-answer-text ${checkResult}`}>
                  {userInput || '(empty)'}
                </div>
                <div className="practice-reading-answer-label">Correct answer:</div>
                <div className="practice-reading-answer-text correct">
                  {correctAnswer || '(not available)'}
                </div>
              </div>
            </div>
            <button 
              className="practice-next-btn"
              onClick={handleCheck}
            >
              NEXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
