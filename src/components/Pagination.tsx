
// Unified pagination component supporting two modes:
// - count: known total items (page numbers derived from total + pageSize)
// - cursor: unknown total (Prev/Next only)

interface CountModeProps {
  mode: 'count';
  page: number; // 1-based
  pageSize: number;
  total: number; // total items
  sizes?: number[];
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

interface CursorModeProps {
  mode: 'cursor';
  pageIndex: number; // 0-based
  pageSize: number;
  hasPrev: boolean;
  hasNext: boolean;
  sizes?: number[];
  loading?: boolean;
  maxKnownPage?: number; // cached pages length (for debugging if needed)
  totalPages?: number | null; // fully known total pages (null if unknown)
  onPrev: () => void;
  onNext: () => void;
  onPageSizeChange?: (size: number) => void;
}

export type PaginationProps = CountModeProps | CursorModeProps;

import { useEffect, useState } from 'react';

export default function Pagination(props: PaginationProps) {
  const sizes = props.sizes || [20, 50, 100, 200];
  const disabled = props.loading;
  const [pageInput, setPageInput] = useState<number>(props.mode === 'count' ? props.page : (props.pageIndex + 1));
  useEffect(() => {
    if (props.mode === 'count') setPageInput(props.page);
    else setPageInput(props.pageIndex + 1);
  }, [props.mode, (props as any).page, (props as any).pageIndex]);

  if (props.mode === 'count') {
    const { page, pageSize, total, onPageChange, onPageSizeChange } = props;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clamp = (p: number) => Math.min(totalPages, Math.max(1, p));
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs whitespace-nowrap">
          <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-family)', fontWeight: 500 }}>Page size:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange?.(Number(e.currentTarget.value) || pageSize)}
            disabled={disabled}
            style={{
              background: 'var(--secondary)',
              border: '2px solid var(--primary)',
              borderRadius: '8px',
              padding: '4px 8px',
              color: 'var(--primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '12px',
              fontWeight: 500
            }}
          >
            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={{
              background: 'var(--secondary)',
              border: '2px solid var(--primary)',
              borderRadius: '8px',
              padding: '4px 12px',
              color: 'var(--primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: (disabled || page <= 1) ? 'not-allowed' : 'pointer',
              opacity: (disabled || page <= 1) ? 0.4 : 1,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!disabled && page > 1) {
                e.currentTarget.style.background = 'var(--hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--secondary)';
            }}
          >Prev</button>
          <button
            type="button"
            disabled={disabled || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={{
              background: 'var(--secondary)',
              border: '2px solid var(--primary)',
              borderRadius: '8px',
              padding: '4px 12px',
              color: 'var(--primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: (disabled || page >= totalPages) ? 'not-allowed' : 'pointer',
              opacity: (disabled || page >= totalPages) ? 0.4 : 1,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!disabled && page < totalPages) {
                e.currentTarget.style.background = 'var(--hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--secondary)';
            }}
          >Next</button>
          <span style={{ fontSize: '12px', color: 'var(--primary)', fontFamily: 'var(--font-family)', fontWeight: 500 }}>Page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = Number((e.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(val)) onPageChange(clamp(val));
              }
            }}
            onChange={(e) => {
              const val = Number(e.currentTarget.value);
              setPageInput(Number.isFinite(val) ? val : pageInput);
            }}
            onBlur={(e) => {
              const val = Number(e.currentTarget.value);
              if (Number.isFinite(val)) onPageChange(clamp(val));
            }}
            disabled={disabled}
            style={{
              width: '64px',
              background: 'var(--secondary)',
              border: '2px solid var(--primary)',
              borderRadius: '8px',
              padding: '4px 8px',
              color: 'var(--primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '12px',
              fontWeight: 500,
              textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--primary)', fontFamily: 'var(--font-family)', fontWeight: 500 }}>/ {totalPages}</span>
        </div>
        <div className="ml-auto" style={{ fontSize: '12px', color: 'var(--neutral)', fontFamily: 'var(--font-family)', fontWeight: 400, whiteSpace: 'nowrap' }}>
          Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
        </div>
      </div>
    );
  }

  // cursor mode
  const { pageIndex, pageSize, hasPrev, hasNext, onPrev, onNext, onPageSizeChange, totalPages } = props;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-2 text-xs whitespace-nowrap">
        <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-family)', fontWeight: 500 }}>Page size:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.currentTarget.value) || pageSize)}
          disabled={disabled}
          style={{
            background: 'var(--secondary)',
            border: '2px solid var(--primary)',
            borderRadius: '8px',
            padding: '4px 8px',
            color: 'var(--primary)',
            fontFamily: 'var(--font-family)',
            fontSize: '12px',
            fontWeight: 500
          }}
        >
          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <button
          type="button"
          disabled={disabled || !hasPrev}
          onClick={onPrev}
          style={{
            background: 'var(--secondary)',
            border: '2px solid var(--primary)',
            borderRadius: '8px',
            padding: '4px 12px',
            color: 'var(--primary)',
            fontFamily: 'var(--font-family)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: (disabled || !hasPrev) ? 'not-allowed' : 'pointer',
            opacity: (disabled || !hasPrev) ? 0.4 : 1,
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (!disabled && hasPrev) {
              e.currentTarget.style.background = 'var(--hover-bg)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--secondary)';
          }}
        >Prev</button>
        <button
          type="button"
          disabled={disabled || !hasNext}
          onClick={onNext}
          style={{
            background: 'var(--secondary)',
            border: '2px solid var(--primary)',
            borderRadius: '8px',
            padding: '4px 12px',
            color: 'var(--primary)',
            fontFamily: 'var(--font-family)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: (disabled || !hasNext) ? 'not-allowed' : 'pointer',
            opacity: (disabled || !hasNext) ? 0.4 : 1,
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (!disabled && hasNext) {
              e.currentTarget.style.background = 'var(--hover-bg)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--secondary)';
          }}
        >Next</button>
        <span style={{ fontSize: '12px', color: 'var(--primary)', fontFamily: 'var(--font-family)', fontWeight: 500 }}>
          {totalPages != null ? `Page ${pageIndex + 1} / ${totalPages}` : `Page ${pageIndex + 1}`}
        </span>
      </div>
    </div>
  );
}
