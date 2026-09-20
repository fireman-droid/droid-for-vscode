// Adapted from Vercel AI Elements (Apache-2.0), tool.tsx 9a22010eb5985b20c7256a881451fc252271942e.
// Changes: controlled disclosure, native Droid status labels, compact editor presentation.
// No raw tool inputs, AI SDK lifecycle conversion or second code renderer.
// Copyright 2023 Vercel, Inc. See ../THIRD_PARTY_LICENSES.txt.
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';

export function Tool({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn('group/tool min-w-0', className)} {...props} />;
}

export function ToolHeader({
  title,
  status,
  icon,
  className,
  onClick,
  ...props
}: ComponentProps<typeof CollapsibleTrigger> & {
  readonly title: string;
  readonly status: string;
  readonly icon?: ReactNode;
}) {
  return (
    <CollapsibleTrigger {...props} onClick={onClick} asChild>
      <Button variant="plain" size="none"
        className={cn('v2-chat-disclosure flex w-full min-w-0 select-none items-center gap-1.5 rounded py-1 text-left text-xs text-muted-foreground hover:text-foreground', className)}>
        <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90 motion-reduce:transition-none" />
        {icon}
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span>
      </Button>
    </CollapsibleTrigger>
  );
}

export function ToolContent({ className, children, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className="v2-tool-content min-w-0 overflow-hidden" {...props}>
    <div className={cn('min-w-0 pb-2 pl-4 text-xs text-muted-foreground', className)}>{children}</div>
  </CollapsibleContent>;
}
