import { useI18n } from '../i18n';
import { createContext, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Tooltip } from '../ui/overlays';
import { formatExactMessageTime } from './MessageTimestamp';

export const UserMessageAnchorContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function UserMessageBubble({ children, attachments, context, onEdit, placeholder, pending, timestamp }: {
  readonly children: ReactNode;
  readonly attachments?: ReactNode;
  readonly context?: ReactNode;
  readonly onEdit?: () => void;
  readonly placeholder?: boolean;
  readonly pending?: boolean;
  readonly timestamp?: number | null;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLDivElement>(null);
  const bubble = <div ref={anchor} className={cn('v2-user-message select-none outline-none focus-visible:outline-1 focus-visible:outline-[var(--focus)]', pending && 'opacity-[.72]')}
    tabIndex={!onEdit && timestamp !== undefined && !placeholder ? 0 : undefined}>
    {attachments}
    {context}
    {onEdit ? <Button variant="plain" size="none" data-transcript-selectable="" className="v2-user-copy block w-full select-none text-left"
      tabIndex={placeholder ? -1 : undefined} aria-label={t("Edit message and resend from here")}
      title={timestamp === undefined ? t("Click to edit and resend from here") : undefined} onClick={onEdit}>{children}</Button>
      : <div className="v2-user-copy min-w-0 w-full select-none">{children}</div>}
  </div>;
  return <UserMessageAnchorContext.Provider value={anchor}>
    {timestamp === undefined || placeholder ? bubble : <Tooltip content={formatExactMessageTime(timestamp)}>{bubble}</Tooltip>}
  </UserMessageAnchorContext.Provider>;
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
    className={cn('min-w-0', Boolean(plan) && 'dvx-question-plan-card', placeholder && 'invisible pointer-events-none')}>
    <UserMessageBubble attachments={attachments} onEdit={onEdit} placeholder={placeholder}>
      {quote ? <span className="mb-[5px] block max-h-[2lh] overflow-hidden text-[11px] leading-[1.42] text-muted-foreground">{quote}</span> : null}
      <span className="block max-h-[4lh] overflow-hidden">{text}</span>
    </UserMessageBubble>
    {plan}
  </div>;
}
