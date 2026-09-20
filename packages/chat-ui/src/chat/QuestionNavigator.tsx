import { ChevronDown, ChevronUp } from 'lucide-react';
import { visibleQuestionItems, type QuestionNavigationItem } from '../navigation/questionNavigation';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';

export function QuestionNavigator({ items, activeIndex, onNavigate }: {
  readonly items: readonly QuestionNavigationItem[];
  readonly activeIndex: number;
  readonly onNavigate: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const current = Math.min(Math.max(activeIndex, 0), items.length - 1);
  const visible = visibleQuestionItems(items, current);
  const dense = items.length > 6;
  return <nav aria-label="Question navigation" className="absolute right-0 top-1/2 z-20 flex max-h-[min(52%,246px)] w-[18px] -translate-y-1/2 flex-col items-center text-muted-foreground"
    style={{ height: Math.max(4, (visible.length - 1) * (dense ? 10 : 14) + 4) + 42 }}>
    <Button variant="ghost" size="icon-sm" className="size-[18px] shrink-0 p-0 [&_svg]:size-2.5" aria-label="Previous question" disabled={current === 0}
      onClick={() => onNavigate(items[current - 1]!.key)}><ChevronUp /></Button>
    <div className={`relative my-[3px] flex min-h-0 w-[18px] flex-1 flex-col items-center justify-between ${dense ? 'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-current before:opacity-10' : ''}`}>
      {visible.map(({ item, index }) => (
        <Button key={item.key} variant="plain" size="none"
          aria-label={`Jump to question ${index + 1}: ${item.preview}`}
          aria-current={index === current ? 'true' : undefined}
          onClick={() => onNavigate(item.key)}
          className="group relative grid h-2 w-[18px] shrink-0 place-items-center outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <span aria-hidden className={cn('size-[3px] rounded-full bg-current opacity-50 transition-[opacity,color] duration-150 motion-reduce:transition-none group-hover:text-foreground group-hover:opacity-100',
            Math.abs(index - current) === 1 && 'opacity-75',
            index === current && 'size-[7px] text-foreground opacity-100')} />
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-[calc(100%+8px)] line-clamp-3 w-max max-w-[min(280px,calc(100vw-54px))] -translate-y-1/2 rounded-[9px] border border-[var(--panel-edge)] bg-popover px-2.5 py-[7px] text-left text-[11.5px] leading-[17px] text-foreground opacity-0 shadow-sm transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100">{item.preview}</span>
        </Button>
      ))}
    </div>
    <Button variant="ghost" size="icon-sm" className="size-[18px] shrink-0 p-0 [&_svg]:size-2.5" aria-label="Next question" disabled={current === items.length - 1}
      onClick={() => onNavigate(items[current + 1]!.key)}><ChevronDown /></Button>
  </nav>;
}
