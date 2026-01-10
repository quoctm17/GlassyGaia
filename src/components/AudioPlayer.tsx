import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Play, Pause } from "lucide-react";
import { useUser } from '../context/UserContext';
import { apiIncrementListeningSession } from '../services/userTracking';

interface AudioPlayerProps {
  src: string;
  className?: string;
  volume?: number; // 0-100
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
}

export interface AudioPlayerHandle {
  currentTime: number;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
}

function formatTime(sec: number) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(({ src, className, volume = 80, onTimeUpdate, onEnded }, ref) => {
  const { user } = useUser();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const hasIncrementedListeningSession = useRef<boolean>(false);
  const isIncrementingListeningSession = useRef<boolean>(false);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    get currentTime() {
      return audioRef.current?.currentTime || 0;
    },
    set currentTime(value: number) {
      if (audioRef.current) {
        audioRef.current.currentTime = value;
      }
    },
    play: () => {
      audioRef.current?.play();
    },
    pause: () => {
      audioRef.current?.pause();
    },
    togglePlayPause: () => {
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
        } else {
          audioRef.current.pause();
        }
      }
    }
  }));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    // Register this instance
    activeAudioInstances.add(audio);
    
    const onTime = () => {
      const time = audio.currentTime;
      setCurrent(time);
      onTimeUpdate?.(time);
    };
    const onLoaded = () => setDuration(audio.duration || 0);
    
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      activeAudioInstances.delete(audio);
    };
  }, [onTimeUpdate]);

  // Sync volume from props (0-100) to audio element (0-1)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(100, volume)) / 100;
  }, [volume]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      // Pause all other audio instances
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audio) {
          otherAudio.pause();
        }
      });
      // Reset listening session flag for new play session
      hasIncrementedListeningSession.current = false;
      audio.play();
      setPlaying(true);
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = Number(e.target.value);
    audio.currentTime = val;
    setCurrent(val);
  };

  // Sync play/pause state and track listening sessions
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const onPlay = () => {
      // Pause all other instances when this one plays
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audio) {
          otherAudio.pause();
        }
      });
      setPlaying(true);
      
      // Track listening session when audio starts playing
      if (!hasIncrementedListeningSession.current && !isIncrementingListeningSession.current && user?.uid) {
        hasIncrementedListeningSession.current = true;
        isIncrementingListeningSession.current = true;
        
        // Increment listening session count (fire and forget, don't block audio play)
        apiIncrementListeningSession()
          .then(() => {
            isIncrementingListeningSession.current = false;
          })
          .catch(err => {
            console.warn('Failed to increment listening session:', err);
            isIncrementingListeningSession.current = false;
          });
      }
    };
    
    const onPause = () => setPlaying(false);
    
    const onEndedHandler = () => {
      setPlaying(false);
      // Reset flag when audio ends so next play will increment again
      hasIncrementedListeningSession.current = false;
      onEnded?.();
    };
    
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEndedHandler);
    
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEndedHandler);
    };
  }, [user?.uid, onEnded]);

  return (
    <div
      className={
        "pixel-audio-player flex items-center gap-3 w-full px-3 py-2 rounded-xl border-2 shadow-lg relative " +
        (className || "")
      }
      style={{ minHeight: 54, backgroundColor: '#18101e', borderColor: 'var(--primary)' }}
    >
      <button
        className="group p-1.5 rounded-full shadow relative"
        style={{ backgroundColor: 'var(--primary)', color: '#FFFFFF' }}
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        data-tooltip={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? <Pause size={22} /> : <Play size={22} />}
        <span className="audio-player-tooltip">
          {playing ? "Pause (Space)" : "Play (Space)"}
        </span>
      </button>
      <span className="typography-inter-4 font-bold min-w-[48px] text-right" style={{ color: 'var(--text)' }}>
        {formatTime(current)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={current}
        onChange={onSeek}
        className="mx-2 flex-1 h-1 rounded-lg outline-none transition-all"
        style={{ 
          background: `linear-gradient(90deg, var(--primary) ${(current/(duration||1))*100}%, var(--neutral) ${(current/(duration||1))*100}%)`,
          accentColor: 'var(--primary)'
        }}
      />
      <span className="typography-inter-4 font-bold min-w-[48px]" style={{ color: 'var(--text)' }}>
        {formatTime(duration)}
      </span>
      <audio 
        ref={audioRef} 
        src={src} 
        preload="none" 
        style={{ display: "none" }}
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
