import { useState, useRef, useEffect, useCallback } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { apiTrackTime } from '../../services/userTracking';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice/practice-listening.css';
import '../../styles/pages/practice-page.css';

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeListeningProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onCheck: () => void;
}

export default function PracticeListening({ card, onCheck }: PracticeListeningProps) {
  const { user, preferences } = useUser();
  const [userInput, setUserInput] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [checkResult, setCheckResult] = useState<'correct' | 'incorrect' | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mainLang = preferences?.main_language || 'en';
  const sentence = card.subtitle?.[mainLang] || card.sentence || '';
  const correctAnswer = card.card_type || ''; // card_type contains the correct answer
  
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

  // Track listening time (debounced to avoid too many API calls)
  const listeningTimeAccumulatorRef = useRef<number>(0);
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningStartTimeRef = useRef<number | null>(null);
  const listeningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const handleTrackListening = useCallback((seconds: number) => {
    if (!user?.uid || seconds <= 0) return;
    
    listeningTimeAccumulatorRef.current += seconds;
    
    // Debounce: accumulate and send every 5 seconds
    if (listeningTimeoutRef.current) {
      clearTimeout(listeningTimeoutRef.current);
    }
    
    listeningTimeoutRef.current = setTimeout(async () => {
      const totalSeconds = listeningTimeAccumulatorRef.current;
      if (totalSeconds > 0 && user?.uid) {
        listeningTimeAccumulatorRef.current = 0;
        try {
          await apiTrackTime(user.uid, totalSeconds, 'listening');
        } catch (error) {
          console.error('Failed to track listening time:', error);
        }
      }
    }, 5000);
  }, [user?.uid]);

  // Track listening time when audio is playing
  useEffect(() => {
    if (!user?.uid || !isPlaying) {
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
        listeningIntervalRef.current = null;
      }
      return;
    }
    
    // Start tracking when audio starts playing
    listeningStartTimeRef.current = Date.now();
    listeningIntervalRef.current = setInterval(() => {
      if (listeningStartTimeRef.current && isPlaying) {
        const elapsed = (Date.now() - listeningStartTimeRef.current) / 1000;
        if (elapsed >= 5) {
          handleTrackListening(5);
          listeningStartTimeRef.current = Date.now(); // Reset for next interval
        }
      }
    }, 5000);
    
    return () => {
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
        listeningIntervalRef.current = null;
      }
      if (listeningStartTimeRef.current && isPlaying) {
        const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          handleTrackListening(elapsed);
        }
        listeningStartTimeRef.current = null;
      }
    };
  }, [isPlaying, user?.uid, handleTrackListening]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current);
      }
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
      }
      // Send any remaining accumulated time
      if (listeningTimeAccumulatorRef.current > 0 && user?.uid) {
        apiTrackTime(user.uid, listeningTimeAccumulatorRef.current, 'listening').catch(() => {});
      }
    };
  }, [user?.uid]);

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
    // Reset listening time tracking
    if (listeningIntervalRef.current) {
      clearInterval(listeningIntervalRef.current);
      listeningIntervalRef.current = null;
    }
    if (listeningStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
      if (elapsed > 0 && user?.uid) {
        handleTrackListening(elapsed);
      }
      listeningStartTimeRef.current = null;
    }
  }, [card.id, user?.uid, handleTrackListening]);
  
  // Normalize text for comparison
  // Removes ruby text (brackets), punctuation, normalizes spacing
  // Preserves diacritics (accents) for languages like Vietnamese
  const normalizeText = (text: string): string => {
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
  
  const handleCheck = () => {
    if (hasChecked) {
      // If already checked, proceed to next card
      onCheck();
      return;
    }
    
    // Normalize user input and correct answer for comparison
    const normalizedInput = normalizeText(userInput);
    const normalizedAnswer = normalizeText(correctAnswer);
    
    // Check if answer is correct
    const isCorrect = normalizedInput === normalizedAnswer;
    setCheckResult(isCorrect ? 'correct' : 'incorrect');
    setHasChecked(true);
  };

  return (
    <div className="practice-component">
      {/* Image with Play Button */}
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

      {/* Input Section with blank or Result Section */}
      {!hasChecked ? (
        <div className="practice-input-section">
          <div className="practice-listening-sentence">
            {sentence.split(' ').map((word, idx, words) => {
              // Show blank for the last word
              if (idx === words.length - 1) {
                return (
                  <span key={idx}>
                    <input
                      type="text"
                      className="practice-blank-input"
                      placeholder="..."
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCheck();
                        }
                      }}
                    />
                  </span>
                );
              }
              return <span key={idx}>{word} </span>;
            })}
          </div>
          <button 
            className="practice-check-btn"
            onClick={handleCheck}
            disabled={!userInput.trim()}
          >
            CHECK
          </button>
        </div>
      ) : (
        <div className={`practice-listening-result-container ${checkResult}`}>
          <div className={`practice-listening-result-header ${checkResult}`}>
            {checkResult === 'correct' ? (
              <>
                <div className="practice-listening-success-icon">
                  <div className="practice-listening-success-icon-check"></div>
                </div>
                <span className="typography-noto-success-text">Great job</span>
              </>
            ) : (
              <>
                <div className="practice-listening-error-icon">
                  <div className="practice-listening-error-icon-x"></div>
                </div>
                <span className="typography-noto-error-text">That's not correct</span>
              </>
            )}
          </div>
          <div className="practice-input-section">
            <div className="practice-listening-result-content">
              <div className="practice-listening-sentence">
                {sentence.split(' ').map((word, idx, words) => {
                  // Show blank for the last word with correct/incorrect styling
                  if (idx === words.length - 1) {
                    return (
                      <span key={idx}>
                        <input
                          type="text"
                          className={`practice-blank-input ${checkResult}`}
                          placeholder="..."
                          value={userInput}
                          disabled
                          readOnly
                        />
                      </span>
                    );
                  }
                  return <span key={idx}>{word} </span>;
                })}
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
