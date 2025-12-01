import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Play, Pause } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  className?: string;
  poster?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onCardClick?: () => void;
}

export interface VideoPlayerHandle {
  currentTime: number;
  play: () => void;
  pause: () => void;
}

function formatTime(sec: number) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Global registry to ensure only one video plays at a time
const activeVideoInstances = new Set<HTMLVideoElement>();

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ src, poster, className, onTimeUpdate, onCardClick }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    get currentTime() {
      return videoRef.current?.currentTime || 0;
    },
    set currentTime(value: number) {
      if (videoRef.current) {
        videoRef.current.currentTime = value;
      }
    },
    play: () => {
      videoRef.current?.play();
    },
    pause: () => {
      videoRef.current?.pause();
    }
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    // Register this instance
    activeVideoInstances.add(video);
    
    const onTime = () => {
      const time = video.currentTime;
      setCurrent(time);
      onTimeUpdate?.(time);
    };
    const onLoaded = () => setDuration(video.duration || 0);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
      activeVideoInstances.delete(video);
    };
  }, [onTimeUpdate]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      // Pause all other video instances
      activeVideoInstances.forEach((otherVideo) => {
        if (otherVideo !== video) {
          otherVideo.pause();
        }
      });
      video.play();
      setPlaying(true);
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = Number(e.target.value);
    video.currentTime = val;
    setCurrent(val);
  };

  // Sync play/pause state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => {
      // Pause all other instances when this one plays
      activeVideoInstances.forEach((otherVideo) => {
        if (otherVideo !== video) {
          otherVideo.pause();
        }
      });
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  return (
    <div className={className || ""}>
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          className="w-full rounded-lg"
          preload="metadata"
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            togglePlay();
            onCardClick?.();
          }}
        />
        {/* Custom controls overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex items-center gap-3">
            <button
              className="group p-1.5 rounded-full bg-pink-200 hover:bg-pink-300 text-pink-700 shadow"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <span className="text-xs font-bold text-white min-w-[48px] text-right">
              {formatTime(current)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.01}
              value={current}
              onChange={onSeek}
              className="flex-1 accent-pink-400 h-1 bg-pink-100 rounded-lg outline-none transition-all"
              style={{ background: `linear-gradient(90deg,#c75485 ${(current/(duration||1))*100}%,#aee0e7 ${(current/(duration||1))*100}%)` }}
            />
            <span className="text-xs font-bold text-white min-w-[48px]">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
