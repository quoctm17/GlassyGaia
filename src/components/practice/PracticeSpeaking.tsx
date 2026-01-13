import { useState, useRef, useEffect } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { Mic } from 'lucide-react';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice.css';

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeSpeakingProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onNext: () => void;
}

export default function PracticeSpeaking({ card, onNext: _onNext }: PracticeSpeakingProps) {
  const { preferences } = useUser();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mainLang = preferences?.main_language || 'en';
  const sentence = card.subtitle?.[mainLang] || card.sentence || '';
  const subtitle = card.subtitle || {};
  
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

  // Reset audio when card changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setImageError(false);
  }, [card.id]);
  
  const handleMicrophoneClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          // TODO: Process audio data for speech recognition
          console.log('Audio data:', event.data);
        };
        
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          // TODO: Analyze speech and provide feedback
        };
        
        mediaRecorder.start();
        setIsRecording(true);
      } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Microphone access denied. Please enable microphone permissions.');
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
        >
          <Mic size={48} />
        </button>
      </div>
    </div>
  );
}
