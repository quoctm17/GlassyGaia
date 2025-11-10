import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

interface Props {
  audioUrl: string;
  active: boolean; // when true, decode and draw
  className?: string; // for positioning (e.g., absolute inset-0)
  barColor?: string; // CSS color, default pink
}

// Lightweight static waveform renderer:
// - On first activation, fetch + decode audio, compute downsampled peaks and draw to canvas
// - No audio playback required; avoids continuous analyser loop
export default function AudioWaveformPreview({ audioUrl, active, className, barColor = "#ec4899" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (fetchedRef.current) return; // decode once per mount/url
    fetchedRef.current = true;

    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(audioUrl, { mode: "cors" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
  const AC: typeof AudioContext | undefined = window.AudioContext || window.webkitAudioContext;
  const ctx = AC ? new AC() : undefined;
  if (!ctx) throw new Error("AudioContext unsupported");
        const audio = await ctx.decodeAudioData(buf.slice(0));
        const ch = audio.getChannelData(0);
        // Downsample to N bars
        const bars = Math.min(200, Math.max(80, Math.floor((canvasRef.current?.clientWidth || 240) / 2)));
        const samplesPerBar = Math.floor(ch.length / bars) || 1;
        const next: number[] = new Array(bars).fill(0);
        for (let i = 0; i < bars; i++) {
          let max = 0;
          const start = i * samplesPerBar;
          const end = Math.min(ch.length, start + samplesPerBar);
          for (let j = start; j < end; j++) {
            const v = Math.abs(ch[j]);
            if (v > max) max = v;
          }
          next[i] = max;
        }
        if (!cancelled) setPeaks(next);
        ctx.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg || "Failed to load audio");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [active, audioUrl]);

  useEffect(() => {
    if (!peaks || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const height = canvas.clientHeight * dpr;
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Background gradient for subtle glass look
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "rgba(12,9,18,0.6)");
    bg.addColorStop(1, "rgba(12,9,18,0.8)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const mid = canvas.height / 2;
    const gap = 2 * dpr; // gap between bars
    const barW = Math.max(dpr, (canvas.width - gap * peaks.length) / peaks.length);
    ctx.fillStyle = barColor;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * (barW + gap);
      const amp = Math.max(0.05, peaks[i]);
      const h = amp * (canvas.height * 0.85);
      const y = mid - h / 2;
      // rounded rect bars
      const r = Math.min(barW, 6 * dpr);
      roundRect(ctx, x, y, barW, h, r);
      ctx.fill();
    }
  }, [peaks, barColor]);

  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <canvas ref={canvasRef} className="w-full h-full opacity-0 transition-opacity duration-200" style={{ opacity: active && (peaks || error) ? 0.92 : 0 }} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radii = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radii, y);
  ctx.arcTo(x + w, y, x + w, y + h, radii);
  ctx.arcTo(x + w, y + h, x, y + h, radii);
  ctx.arcTo(x, y + h, x, y, radii);
  ctx.arcTo(x, y, x + w, y, radii);
  ctx.closePath();
}
