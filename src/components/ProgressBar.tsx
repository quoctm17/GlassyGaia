
export default function ProgressBar({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(Number.isFinite(percent) ? percent : 0, 100));
  return (
    <div className="w-full bg-gray-800 rounded h-3 overflow-hidden border border-gray-700 relative">
      <div
        className="bg-gradient-to-r from-pink-500 to-pink-300 h-full transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
      <div className="absolute right-2 top-0 text-[11px] text-white font-semibold" style={{ lineHeight: '0.75rem' }}>{pct}%</div>
    </div>
  );
}
