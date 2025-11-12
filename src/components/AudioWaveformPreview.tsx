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
        // Downsample to N bars (denser and smoother)
        const density = 3; // pixels per bar approx
        const targetBars = Math.min(320, Math.max(100, Math.floor((canvasRef.current?.clientWidth || 300) / density)));
        const samplesPerBar = Math.max(1, Math.floor(ch.length / targetBars));
        const raw: number[] = new Array(targetBars).fill(0);
        for (let i = 0; i < targetBars; i++) {
          let max = 0;
          const start = i * samplesPerBar;
          const end = Math.min(ch.length, start + samplesPerBar);
          for (let j = start; j < end; j++) max = Math.max(max, Math.abs(ch[j]));
          raw[i] = max;
        }
        // Smooth with moving average to avoid jagged bars
        const smoothWindow = 3;
        const next = raw.map((_, i) => {
          let sum = 0, count = 0;
          for (let k = -smoothWindow; k <= smoothWindow; k++) {
            const idx = i + k;
            if (idx >= 0 && idx < raw.length) { sum += raw[idx]; count++; }
          }
          return sum / (count || 1);
        });
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
    bg.addColorStop(0, "rgba(20,16,30,0.55)");
    bg.addColorStop(1, "rgba(12,9,18,0.85)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const mid = canvas.height / 2;
    const gap = 1.5 * dpr; // tighter gap
    const barW = Math.max(dpr, (canvas.width - gap * peaks.length) / peaks.length);
    // Pink → fuchsia vertical gradient for bars
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#f9a8d4");
    grad.addColorStop(0.5, barColor);
    grad.addColorStop(1, "#a78bfa");
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(236,72,153,0.35)"; // outer glow
    ctx.shadowBlur = 8 * dpr;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * (barW + gap);
      const amp = Math.max(0.04, peaks[i]);
      const h = amp * (canvas.height * 0.78);
      const r = Math.min(barW, 5 * dpr);
      // Draw mirrored bars for a fuller waveform look
      const yTop = mid - h;
      const yBot = mid;
      roundRect(ctx, x, yTop, barW, h, r);
      ctx.fill();
      roundRect(ctx, x, yBot, barW, h, r);
      ctx.fill();
    }

    // Center baseline
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(249,168,212,0.4)";
    ctx.fillRect(0, mid - 0.5 * dpr, canvas.width, 1 * dpr);
  }, [peaks, barColor]);

  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <canvas ref={canvasRef} className="w-full h-full opacity-0 transition-opacity duration-200" style={{ opacity: active && (peaks || error) ? 1 : 0 }} />
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
