import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './selection';

export function Pagination({ label, page, pageSize, count, complete, loading, disabled, compact = false, onPage, onPageSize }: {
  label: string; page: number; pageSize: number; count: number; complete: boolean;
  loading: boolean; disabled: boolean; compact?: boolean;
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  const { t } = useI18n();
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const first = Math.max(0, Math.min(page - 1, pageCount - 3));
  const last = Math.min(pageCount - 1, first + 2);
  const pages = [...new Set([0, ...Array.from({ length: last - first + 1 }, (_, i) => first + i), pageCount - 1])];
  return <nav className="dvx-pagination" aria-label={label}>
    <span className="dvx-page-range" aria-live="polite">{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)}` : '0'} {t('条')}{complete && t(' · 共 {p0} 条', { p0: count })}</span>
    {!(compact && complete && count <= 10) && <div className="dvx-pagination-controls">
      <Select value={String(pageSize)} disabled={disabled} onValueChange={value => onPageSize(Number(value))}>
        <SelectTrigger aria-label={t('每页条数')}><SelectValue /></SelectTrigger>
        <SelectContent align="end">{[10, 20, 50].map(size => <SelectItem key={size} value={String(size)}>{t('{count} 条 / 页', { count: size })}</SelectItem>)}</SelectContent>
      </Select>
      <div className="dvx-page-numbers">
        <Button variant="plain" size="icon-sm" aria-label={t('上一页')} disabled={disabled || page === 0} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        {pages.map((value, index) => <span className="dvx-page-number" key={value}>
          {index > 0 && value > pages[index - 1]! + 1 && <span className="dvx-page-gap" aria-hidden>…</span>}
          <Button variant="plain" size="icon-sm" aria-label={t('第 {p0} 页', { p0: value + 1 })} aria-current={page === value ? 'page' : undefined}
            disabled={disabled} onClick={() => onPage(value)}>{value + 1}</Button>
        </span>)}
        {!complete && <span className="dvx-page-gap" aria-label={t('还有记录尚未读取')}>…</span>}
        <Button variant="plain" size="icon-sm" aria-label={loading ? t('正在读取记录') : t('下一页')} disabled={disabled || complete && page >= pageCount - 1}
          onClick={() => onPage(page + 1)}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ChevronRight />}</Button>
      </div>
    </div>}
  </nav>;
}
