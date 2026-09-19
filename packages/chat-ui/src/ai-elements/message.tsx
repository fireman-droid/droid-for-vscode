// Adapted from Vercel AI Elements (Apache-2.0), message.tsx c04a39935d0ce55b78fef14bbb03be7231d9092f.
// Changes: editor density, explicit roles, no AI SDK state, branch runtime or Streamdown.
// Copyright 2023 Vercel, Inc. See ../THIRD_PARTY_LICENSES.txt.
import type { ComponentProps } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Tooltip } from '../ui/overlays';

export function Message({
  from,
  className,
  ...props
}: ComponentProps<'div'> & { readonly from: 'user' | 'assistant' }) {
  return <div className={cn('group flex w-full min-w-0 flex-col gap-2', from === 'user' ? 'is-user' : 'is-assistant', className)} {...props} />;
}

export function MessageContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 max-w-full flex-col gap-2 text-[13px] leading-relaxed text-foreground', className)} {...props} />;
}

export function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-1', className)} {...props} />;
}

export function MessageAction({ label, ...props }: ComponentProps<typeof Button> & { readonly label: string }) {
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} {...props} />
    </Tooltip>
  );
}
