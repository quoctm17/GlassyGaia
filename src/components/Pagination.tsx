
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

export default function Pagination(props: PaginationProps) {
  const sizes = props.sizes || [20, 50, 100, 200];
  const disabled = props.loading;
  // no extra state needed in simplified cursor mode

  if (props.mode === 'count') {
    const { page, pageSize, total, onPageChange, onPageSizeChange } = props;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-pink-200">Page size:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange?.(Number(e.currentTarget.value) || pageSize)}
            disabled={disabled}
            className="bg-[#1f1829] border border-pink-500 rounded px-2 py-1 text-pink-100 text-xs"
          >
            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="admin-btn secondary !px-2 !py-1 text-xs disabled:opacity-40"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >Prev</button>
          <button
            type="button"
            className="admin-btn secondary !px-2 !py-1 text-xs disabled:opacity-40"
            disabled={disabled || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >Next</button>
          <span className="text-xs text-pink-300">Page {page} / {totalPages}</span>
        </div>
        <div className="ml-auto text-xs text-gray-400">
          Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
        </div>
      </div>
    );
  }

  // cursor mode
  const { pageIndex, pageSize, hasPrev, hasNext, onPrev, onNext, onPageSizeChange, totalPages } = props;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-pink-200">Page size:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.currentTarget.value) || pageSize)}
          disabled={disabled}
          className="bg-[#1f1829] border border-pink-500 rounded px-2 py-1 text-pink-100 text-xs"
        >
          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="admin-btn secondary !px-2 !py-1 text-xs disabled:opacity-40"
          disabled={disabled || !hasPrev}
          onClick={onPrev}
        >Prev</button>
        <button
          type="button"
          className="admin-btn secondary !px-2 !py-1 text-xs disabled:opacity-40"
          disabled={disabled || !hasNext}
          onClick={onNext}
        >Next</button>
        <span className="text-xs text-pink-300">
          {totalPages != null ? `Page ${pageIndex + 1} / ${totalPages}` : `Page ${pageIndex + 1}`}
        </span>
      </div>
    </div>
  );
}
