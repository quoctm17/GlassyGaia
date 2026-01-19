import { useState, useRef, useEffect } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { Mic } from 'lucide-react';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice/practice-speaking.css';
import '../../styles/pages/practice-page.css';

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare var SpeechRecognition: {
  new (): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  new (): SpeechRecognition;
};

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof webkitSpeechRecognition;
  }
}

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeSpeakingProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onNext: () => void;
}

// Map language codes to SpeechRecognition language codes
const getSpeechRecognitionLang = (lang: string): string => {
  const langMap: Record<string, string> = {
    'en': 'en-US',
    'vi': 'vi-VN',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'zh': 'zh-CN',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'it': 'it-IT',
    'pt': 'pt-BR',
    'ru': 'ru-RU',
    'ar': 'ar-SA',
    'hi': 'hi-IN',
    'th': 'th-TH',
  };
  return langMap[lang.toLowerCase()] || 'en-US';
};

export default function PracticeSpeaking({ card, onNext }: PracticeSpeakingProps) {
  const { preferences } = useUser();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [checkResult, setCheckResult] = useState<'correct' | 'incorrect' | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mainLang = preferences?.main_language || 'en';
  const sentence = card.subtitle?.[mainLang] || card.sentence || '';
  const subtitle = card.subtitle || {};
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
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
    setImageError(false);
    setUserTranscript('');
    setCheckResult(null);
    setHasChecked(false);
  }, [card.id]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

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
      onNext();
      return;
    }

    if (!userTranscript.trim()) {
      return;
    }
    
    // Normalize user transcript and correct answer for comparison
    const normalizedTranscript = normalizeText(userTranscript);
    const normalizedAnswer = normalizeText(correctAnswer);
    
    // Check if answer is correct
    const isCorrect = normalizedTranscript === normalizedAnswer;
    setCheckResult(isCorrect ? 'correct' : 'incorrect');
    setHasChecked(true);
  };
  
  const handleMicrophoneClick = () => {
    // Check if SpeechRecognition is available
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isRecording) {
      // Stop recording
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsRecording(false);
      }
    } else {
      // Start recording
      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        
        // Configure recognition
        const recognitionLang = getSpeechRecognitionLang(mainLang);
        recognition.lang = recognitionLang;
        recognition.continuous = false; // Stop after first result
        recognition.interimResults = false; // Only final results
        
        recognition.onstart = () => {
          setIsRecording(true);
          setUserTranscript('');
          setCheckResult(null);
          setHasChecked(false);
        };
        
        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setUserTranscript(transcript);
          setIsRecording(false);
          
          // Auto-check after getting result
          setTimeout(() => {
            if (transcript.trim()) {
              // Normalize user transcript and correct answer for comparison
              const normalizedTranscript = normalizeText(transcript);
              const normalizedAnswer = normalizeText(correctAnswer);
              
              // Check if answer is correct
              const isCorrect = normalizedTranscript === normalizedAnswer;
              setCheckResult(isCorrect ? 'correct' : 'incorrect');
              setHasChecked(true);
            }
          }, 100);
        };
        
        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          
          if (event.error === 'no-speech') {
            alert('No speech detected. Please try again.');
          } else if (event.error === 'audio-capture') {
            alert('No microphone found. Please check your microphone connection.');
          } else if (event.error === 'not-allowed') {
            alert('Microphone permission denied. Please enable microphone permissions.');
          } else {
            alert(`Speech recognition error: ${event.error}`);
          }
        };
        
        recognition.onend = () => {
          setIsRecording(false);
        };
        
        recognition.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        alert('Failed to start speech recognition. Please try again.');
        setIsRecording(false);
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

      {/* Phrase Box or Result Section */}
      {!hasChecked ? (
        <>
          {/* Phrase Box */}
          <div className="practice-phrase-box">
            <div className="practice-phrase-english">{sentence}</div>
            {subtitle['vi'] && (
              <div className="practice-phrase-translation">{subtitle['vi']}</div>
            )}
          </div>

          {/* Microphone Button */}
          <div className="practice-microphone-container">
            <button
              className={`practice-microphone-btn ${isRecording ? 'recording' : ''}`}
              onClick={handleMicrophoneClick}
              disabled={isRecording}
            >
              <Mic size={48} />
            </button>
            {userTranscript && (
              <div className="practice-speaking-transcript">
                You said: {userTranscript}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className={`practice-speaking-result-container ${checkResult}`}>
          <div className={`practice-speaking-result-header ${checkResult}`}>
            {checkResult === 'correct' ? (
              <>
                <div className="practice-speaking-success-icon">
                  <div className="practice-speaking-success-icon-check"></div>
                </div>
                <span className="typography-noto-success-text">Great job</span>
              </>
            ) : (
              <>
                <div className="practice-speaking-error-icon">
                  <div className="practice-speaking-error-icon-x"></div>
                </div>
                <span className="typography-noto-error-text">That's not correct</span>
              </>
            )}
          </div>
          <div className="practice-input-section">
            <div className="practice-speaking-result-content">
              <div className="practice-speaking-answer">
                <div className="practice-speaking-answer-label">You said:</div>
                <div className={`practice-speaking-answer-text ${checkResult}`}>
                  {userTranscript || '(no speech detected)'}
                </div>
                <div className="practice-speaking-answer-label">Correct answer:</div>
                <div className="practice-speaking-answer-text correct">
                  {card.card_type || '(not available)'}
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
