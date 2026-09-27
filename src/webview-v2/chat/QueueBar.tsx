import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Circle, CornerDownLeft, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { QuoteChips } from '@droidvisx/chat-ui/chat/QuoteChips';
import { MAX_QUEUED_MESSAGES, type QueuePausedReason, type SessionQueueState } from '../../shared/protocol/queueProtocol';
import type { useComposerFlow } from './composer/useComposerFlow';
import { parseSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

const pausedCopy: Record<QueuePausedReason, string> = {
  stopped: 'paused after stop',
  'turn-failed': 'paused after a failed turn',
  'dispatch-blocked': 'sending is blocked right now',
};

export function QueueBar({ queue, flow }: {
  readonly queue: SessionQueueState;
  readonly flow: Pick<ReturnType<typeof useComposerFlow>,
    'queueEditingId' | 'handleQueueEditBegin' | 'handleQueuePromote' | 'handleQueueRemove' | 'handleQueueResume' | 'handleQueueClear'>;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const previousPause = useRef(queue.paused);
  useEffect(() => {
    if (queue.paused !== null && previousPause.current === null) setExpanded(true);
    previousPause.current = queue.paused;
  }, [queue.paused]);
  if (queue.items.length === 0) return null;
  const meta = queue.paused !== null ? pausedCopy[queue.paused] : queue.items.length >= MAX_QUEUED_MESSAGES ? 'Queue full' : '';
  const label = `${queue.items.length} Queued ${queue.items.length === 1 ? 'Message' : 'Messages'}`;
  const markers = { image: '[image]', pdf: '[pdf]', text: '[file]', editor: '[editor]', selection: '[selection]' };
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild><section aria-label="Queued messages" className="v2-composer-queue">
      <span aria-live="polite" className="sr-only">{label}{meta ? `, ${meta}` : ''}</span>
      <div className="v2-queue-heading">
        <CollapsibleTrigger asChild><Button variant="plain" size="none" aria-controls={id} className="v2-queue-toggle"
          title={meta || 'Sends after the current turn. Queued text restores after reload.'}>
          <ChevronRight aria-hidden="true" className="v2-queue-chevron" />
          <span>{label}</span>
          {meta ? <span className="v2-queue-status">{meta}</span> : null}
        </Button></CollapsibleTrigger>
        <DropdownMenu><DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="v2-queue-menu" aria-label="Queued message actions"><Ellipsis aria-hidden="true" /></Button>
        </DropdownMenuTrigger><DropdownMenuContent align="end">
          {queue.paused !== null ? <DropdownMenuItem onSelect={flow.handleQueueResume}>Resume sending</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={flow.handleQueueClear}><Trash2 aria-hidden="true" className="size-3.5" />Clear queued messages</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
      <AnimatedCollapsibleContent id={id} open={expanded}>
        <div className="v2-queue-list" role="list">
          {queue.items.map((item) => {
            const parsed = parseSelectionQuotes(item.text);
            const body = parsed?.body ?? item.text;
            return <div key={item.queueId} role="listitem" className="v2-queue-item" data-editing={flow.queueEditingId === item.queueId || undefined}>
              <Circle aria-hidden="true" className="v2-queue-marker" />
              <div className="v2-queue-message">
                <div className="v2-queue-preview" title={body}>
                  {item.attachments.map((attachment, index) => <span key={index} title={attachment.name} className="v2-queue-attachment">{markers[attachment.kind]}</span>)}
                  {body}
                </div>
                {parsed ? <QuoteChips quotes={parsed.quotes} /> : null}
              </div>
              {flow.queueEditingId === item.queueId ? <span className="v2-queue-editing">Editing</span> : <div className="v2-queue-actions">
                <Button variant="ghost" size="sm" className="v2-queue-send" aria-label="Send queued message now" onClick={() => flow.handleQueuePromote(item.queueId)}><span>Send Now</span><CornerDownLeft aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Edit queued message" onClick={() => flow.handleQueueEditBegin(item.queueId)}><Pencil aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Remove queued message" onClick={() => flow.handleQueueRemove(item.queueId)}><Trash2 aria-hidden="true" /></Button>
              </div>}
            </div>;
          })}
        </div>
        {queue.paused !== null ? <div className="v2-queue-paused">
          <span>Automatic sending is paused</span>
          <Button variant="ghost" size="sm" onClick={flow.handleQueueResume}>Resume</Button>
        </div> : null}
      </AnimatedCollapsibleContent>
    </section></Collapsible>
  );
}
