
export default function ProgressBar({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(Number.isFinite(percent) ? percent : 0, 100));
  return (
    <div
      className="relative w-full h-3 rounded-full overflow-hidden"
      style={{
        background: 'linear-gradient(90deg, var(--reserved-bg, rgba(229,231,235,0.3)), var(--hover-bg-subtle, rgba(159,18,57,0.1)))',
        border: '1px solid var(--border)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.06) inset',
      }}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      role="progressbar"
    >
      <div
        className="h-full transition-all duration-500 ease-out"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--primary), var(--hover-select))',
        }}
      />
      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold"
        style={{ color: 'var(--text-secondary)' }}
      >
        {pct}%
      </div>
    </div>
  );
}
