import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Play, Pause } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  className?: string;
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

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(({ src, className, onTimeUpdate, onEnded }, ref) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

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
    const onEnd = () => {
      setPlaying(false);
      onEnded?.();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnd);
    
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnd);
      activeAudioInstances.delete(audio);
    };
  }, [onTimeUpdate, onEnded]);

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

  // Sync play/pause state if user uses native controls
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
    };
    const onPause = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  return (
    <div
      className={
        "pixel-audio-player flex items-center gap-3 w-full px-3 py-2 rounded-xl bg-[#18101e] border-2 border-pink-400 shadow-lg relative " +
        (className || "")
      }
      style={{ minHeight: 54 }}
    >
      <button
        className="group p-1.5 rounded-full bg-pink-200 hover:bg-pink-300 text-pink-700 shadow relative"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        data-tooltip={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? <Pause size={22} /> : <Play size={22} />}
        <span className="audio-player-tooltip">
          {playing ? "Pause (Space)" : "Play (Space)"}
        </span>
      </button>
      <span className="text-xs font-bold text-pink-200 min-w-[48px] text-right">
        {formatTime(current)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={current}
        onChange={onSeek}
        className="mx-2 flex-1 accent-pink-400 h-1 bg-pink-100 rounded-lg outline-none transition-all"
        style={{ background: `linear-gradient(90deg,#c75485 ${(current/(duration||1))*100}%,#aee0e7 ${(current/(duration||1))*100}%)` }}
      />
      <span className="text-xs font-bold text-pink-200 min-w-[48px]">
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
