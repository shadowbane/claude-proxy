interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [25, 50, 100];

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/40 border-t border-slate-700/60 text-xs text-slate-400">
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <div className="font-mono">
        {from}&ndash;{to} of {total}
      </div>
      <div className="flex items-center gap-1">
        <button
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
        >
          Prev
        </button>
        <span className="px-2 font-mono">
          {page} / {totalPages}
        </span>
        <button
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
        >
          Next
        </button>
      </div>
    </div>
  );
}
