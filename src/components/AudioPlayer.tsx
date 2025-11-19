import React, { useRef, useState, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, MoreVertical, Download, FastForward } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  className?: string;
}

function formatTime(sec: number) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration || 0);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
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

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = Number(e.target.value);
    audio.volume = val;
    setVolume(val);
    setMuted(val === 0);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !muted;
    setMuted(!muted);
  };

  // Sync play/pause state if user uses native controls
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  // Download handler
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = src.split("/").pop() || "audio.mp3";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowMenu(false);
  };

  // Playback rate handler
  const handleRate = (rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    setPlaybackRate(rate);
    setShowMenu(false);
  };

  return (
    <div
      className={
        "pixel-audio-player flex items-center gap-3 w-full px-3 py-2 rounded-xl bg-[#18101e] border-2 border-pink-400 shadow-lg relative " +
        (className || "")
      }
      style={{ minHeight: 54 }}
    >
      <button
        className="group p-1.5 rounded-full bg-pink-200 hover:bg-pink-300 text-pink-700 shadow"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={22} /> : <Play size={22} />}
      </button>
      <span className="text-xs font-bold text-pink-200 min-w-[48px] text-right">
        {formatTime(current)} / {formatTime(duration)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={current}
        onChange={onSeek}
        className="mx-2 flex-1 accent-pink-400 h-1 bg-pink-100 rounded-lg outline-none transition-all"
        style={{ background: `linear-gradient(90deg,#f9a8d4 ${(current/(duration||1))*100}%,#2d193a ${(current/(duration||1))*100}%)` }}
      />
      <button
        className="ml-2 p-1.5 rounded-full bg-pink-200 hover:bg-pink-300 text-pink-700"
        onClick={toggleMute}
        aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
      >
        {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={onVolume}
        className="w-16 accent-pink-400 h-1 bg-pink-100 rounded-lg outline-none"
      />
      <div className="relative ml-2">
        <button
          className="p-1.5 rounded-full bg-pink-200 hover:bg-pink-300 text-pink-700"
          onClick={() => setShowMenu((v) => !v)}
          aria-label="More options"
        >
          <MoreVertical size={20} />
        </button>
        {showMenu && (
          <div className="absolute right-0 top-10 z-50 min-w-[140px] bg-white text-pink-700 rounded-lg shadow-lg border border-pink-200 py-2 px-2 flex flex-col gap-1 animate-fade-in">
            <button
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-pink-100"
              onClick={handleDownload}
            >
              <Download size={18} /> Download audio
            </button>
            <div className="flex items-center gap-2 px-2 py-1">
              <FastForward size={18} />
              <span className="mr-2">Speed:</span>
              {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  className={`px-2 py-0.5 rounded ${playbackRate === rate ? "bg-pink-200 font-bold" : "hover:bg-pink-100"}`}
                  onClick={() => handleRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <audio ref={audioRef} src={src} preload="none" style={{ display: "none" }} />
    </div>
  );
};

export default AudioPlayer;
