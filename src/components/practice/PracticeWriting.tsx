import { useState, useRef, useEffect } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { apiTrackAttempt } from '../../services/userTracking';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice/practice-writing.css';
import '../../styles/pages/practice-page.css';

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeWritingProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onCheck: () => void;
}

// Word matching result types
interface WordMatchResult {
  type: 'match' | 'wrong' | 'missing';
  word: string;
  expected?: string; // For wrong words, show what was expected
}

export default function PracticeWriting({ card, onCheck }: PracticeWritingProps) {
  const { user } = useUser();
  const [userInput, setUserInput] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [checkResult, setCheckResult] = useState<'correct' | 'incorrect' | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [wordMatchResults, setWordMatchResults] = useState<WordMatchResult[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    setWordMatchResults([]);
  }, [card.id]);
  
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

  // Word-by-word matching algorithm (same as Speaking)
  const compareWords = (targetStr: string, userStr: string): WordMatchResult[] => {
    const target = targetStr.split(' ').filter(w => w.length > 0);
    const user = userStr.split(' ').filter(w => w.length > 0);
    
    let tIndex = 0; // Target Index
    let uIndex = 0; // User Index
    const result: WordMatchResult[] = [];

    while (tIndex < target.length || uIndex < user.length) {
      const tWord = target[tIndex] || "";
      const uWord = user[uIndex] || "";

      if (tWord === uWord) {
        // Scenario A: Perfect Match
        result.push({ type: 'match', word: tWord });
        tIndex++;
        uIndex++;
      } else {
        // Mismatch: Is it a wrong word or a skipped word?
        // Look ahead: Did the user say the *next* target word? (Means they skipped current)
        const nextTWord = target[tIndex + 1] || "";
        
        if (uWord === nextTWord) {
          // Scenario B: User skipped a word (Missing)
          result.push({ type: 'missing', word: tWord });
          tIndex++; // Move target forward, keep user same to catch the match next loop
        } else {
          // Scenario C: User said something else (Wrong)
          // If we run out of target words but user keeps talking, mark as wrong/extra
          if (tWord) {
            result.push({ type: 'wrong', word: uWord, expected: tWord });
            tIndex++;
            uIndex++;
          } else {
            // User said extra words at the end
            result.push({ type: 'wrong', word: uWord, expected: "" });
            uIndex++;
          }
        }
      }
    }
    return result;
  };
  
  const handleCheck = async () => {
    if (hasChecked) {
      // If already checked, proceed to next card
      onCheck();
      return;
    }
    
    // Normalize user input and correct answer for comparison
    const normalizedInput = normalizeText(userInput);
    const normalizedAnswer = normalizeText(correctAnswer);
    
    // Run word-by-word comparison
    const wordResults = compareWords(normalizedAnswer, normalizedInput);
    setWordMatchResults(wordResults);
    
    // Check if answer is correct
    const isCorrect = normalizedInput === normalizedAnswer;
    setCheckResult(isCorrect ? 'correct' : 'incorrect');
    setHasChecked(true);

    // Track writing attempt (award XP)
    if (user?.uid) {
      try {
        await apiTrackAttempt(user.uid, 'writing', card.id, card.film_id);
      } catch (error) {
        console.error('Failed to track writing attempt:', error);
      }
    }
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
          <input
            type="text"
            className="practice-input"
            placeholder="Enter the sentence"
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
        <div className={`practice-writing-result-container ${checkResult}`}>
          <div className={`practice-writing-result-header ${checkResult}`}>
            {checkResult === 'correct' ? (
              <>
                <div className="practice-writing-success-icon">
                  <div className="practice-writing-success-icon-check"></div>
                </div>
                <span className="typography-noto-success-text">Great job</span>
              </>
            ) : (
              <>
                <div className="practice-writing-error-icon">
                  <div className="practice-writing-error-icon-x"></div>
                </div>
                <span className="typography-noto-error-text">That's not correct</span>
              </>
            )}
          </div>
          <div className="practice-input-section">
            <div className="practice-writing-result-content">
              <div className="practice-writing-answer">
                {/* Word-by-word feedback display - showing correct answer with colors */}
                {wordMatchResults.length > 0 ? (
                  <div className="practice-writing-word-feedback">
                    {wordMatchResults
                      .filter(item => item.type !== 'wrong' || item.expected) // Filter out extra words at the end
                      .map((item, index, array) => {
                        const displayWord = item.type === 'wrong' && item.expected 
                          ? item.expected 
                          : item.word;
                        return (
                          <span
                            key={index}
                            className={`practice-writing-word practice-writing-word-${item.type}`}
                            title={item.type === 'wrong' && item.expected ? `You said: ${item.word}` : ''}
                          >
                            {displayWord}
                            {index < array.length - 1 && ' '}
                          </span>
                        );
                      })}
                  </div>
                ) : (
                  <div className="practice-writing-word-feedback">
                    {card.card_type || '(not available)'}
                  </div>
                )}
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
