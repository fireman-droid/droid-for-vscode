import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { ManagementChoice } from './ManagementFields';

export function SessionPagination({ page, pageSize, count, complete, loading, disabled, onPage, onPageSize }: {
  readonly page: number;
  readonly pageSize: number;
  readonly count: number;
  readonly complete: boolean;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const first = Math.max(0, Math.min(page - 1, pageCount - 3));
  const last = Math.min(pageCount - 1, first + 2);
  const pages = [...new Set([0, ...Array.from({ length: last - first + 1 }, (_, i) => first + i), pageCount - 1])];
  return <nav className="management-pagination" aria-label="会话分页">
    <span className="management-page-range" aria-live="polite">{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)}` : '0'} 条{complete && ` · 共 ${count} 条`}</span>
    <div className="management-pagination-controls">
      <ManagementChoice label="每页条数" value={String(pageSize)} disabled={disabled}
        onChange={value => onPageSize(Number(value))} options={[[ '10', '10 条 / 页' ], ['20', '20 条 / 页'], ['50', '50 条 / 页']]} />
      <div className="management-page-numbers">
        <Button variant="plain" size="icon-sm" aria-label="上一页" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        {pages.map((value, index) => <span className="management-page-number" key={value}>
          {index > 0 && value > pages[index - 1]! + 1 && <span className="management-page-gap" aria-hidden>…</span>}
          <Button variant="plain" size="icon-sm" aria-label={`第 ${value + 1} 页`} aria-current={page === value ? 'page' : undefined}
            disabled={disabled} onClick={() => onPage(value)}>{value + 1}</Button>
        </span>)}
        {!complete && <span className="management-page-gap" aria-label="还有会话尚未读取">…</span>}
        <Button variant="plain" size="icon-sm" aria-label={loading ? '正在读取会话' : '下一页'} disabled={disabled || complete && page >= pageCount - 1}
          onClick={() => onPage(page + 1)}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ChevronRight />}</Button>
      </div>
    </div>
  </nav>;
}
