import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';

export function UserMessageBubble({ children, attachments, context, onEdit, placeholder, pending }: {
  readonly children: ReactNode;
  readonly attachments?: ReactNode;
  readonly context?: ReactNode;
  readonly onEdit?: () => void;
  readonly placeholder?: boolean;
  readonly pending?: boolean;
}) {
  return <div className={cn('v2-user-message select-none', pending && 'opacity-[.72]')}>
    {attachments}
    {context}
    {onEdit ? <Button variant="plain" size="none" data-transcript-selectable="" className="v2-user-copy block w-full select-none text-left"
      tabIndex={placeholder ? -1 : undefined} aria-label="Edit message and resend from here"
      title="Click to edit and resend from here" onClick={onEdit}>{children}</Button>
      : <div className="v2-user-copy w-full select-none">{children}</div>}
  </div>;
}

export function UserMessageView({ id, text, quote, attachments, onEdit, placeholder = false, plan }: {
  readonly id: string;
  readonly text: string;
  readonly quote?: string;
  readonly attachments?: ReactNode;
  readonly onEdit?: () => void;
  readonly placeholder?: boolean;
  readonly plan?: ReactNode;
}) {
  return <div data-question-id={id} data-question-card="" inert={placeholder || undefined} aria-hidden={placeholder || undefined}
    className={cn('min-w-0', placeholder && 'invisible pointer-events-none')}>
    <UserMessageBubble attachments={attachments} onEdit={onEdit} placeholder={placeholder}>
      {quote ? <span className="mb-[5px] block max-h-[2lh] overflow-hidden text-[11px] leading-[1.42] text-muted-foreground">{quote}</span> : null}
      <span className="block max-h-[4lh] overflow-hidden">{text}</span>
    </UserMessageBubble>
    {plan}
  </div>;
}
