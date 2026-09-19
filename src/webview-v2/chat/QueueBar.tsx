import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { MAX_QUEUED_MESSAGES, type QueuePausedReason, type SessionQueueState } from '../../shared/protocol/queueProtocol';
import type { useComposerFlow } from '../../webview/assistant/composer/useComposerFlow';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';

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
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const previousPause = useRef(queue.paused);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (queue.paused !== null && previousPause.current === null) setExpanded(true);
    previousPause.current = queue.paused;
  }, [queue.paused]);
  useEffect(() => {
    if (!expanded) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setExpanded(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);
  if (queue.items.length === 0) return null;
  const meta = queue.paused !== null ? pausedCopy[queue.paused] : queue.items.length >= MAX_QUEUED_MESSAGES ? 'queue full' : '⏎ to Send';
  const markers = { image: '[image]', pdf: '[pdf]', text: '[file]', editor: '[editor]', selection: '[selection]' };
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild><section ref={container} aria-label="Queued messages" className="overflow-hidden rounded-[10px] border border-border bg-input-background">
      <span aria-live="polite" className="sr-only">{queue.items.length} messages queued, {meta}</span>
      <CollapsibleTrigger asChild><Button variant="plain" size="none" aria-controls={id} className="flex h-8 w-full items-center gap-2 px-3 text-[11.5px]">
        <span className="flex-1 text-left">{queue.items.length} Queued</span>
        <span className="text-[10px] text-muted-foreground">{meta}</span>
        <ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </Button></CollapsibleTrigger>
      <AnimatedCollapsibleContent id={id} open={expanded}>
        <div className="max-h-56 overflow-y-auto px-3 pb-2">
          {queue.items.map((item) => (
            <div key={item.queueId} className="group flex items-center gap-1 border-t border-border py-1 text-[11.5px] [&_button]:size-6 [&_svg]:size-3">
              <div className="min-w-0 flex-1 truncate" title={item.text}>
                {item.attachments.map((attachment, index) => <span key={index} title={attachment.name} className="mr-1 text-[10px] text-muted-foreground">{markers[attachment.kind]}</span>)}
                {item.text}
              </div>
              {flow.queueEditingId === item.queueId ? <span className="text-[10px] text-muted-foreground">Editing</span> : <div className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <Button variant="ghost" size="icon-sm" aria-label="Edit queued message" onClick={() => flow.handleQueueEditBegin(item.queueId)}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Send queued message now" onClick={() => flow.handleQueuePromote(item.queueId)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Remove queued message" onClick={() => flow.handleQueueRemove(item.queueId)}><Trash2 /></Button>
              </div>}
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-border pt-1 text-[10px] text-muted-foreground">
            <span className="flex-1">{queue.paused !== null ? 'Automatic sending is paused' : 'Sends after the current turn · text restores after reload'}</span>
            {queue.paused !== null ? <>
              <Button variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={flow.handleQueueResume}>Send now</Button>
              <Button variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={flow.handleQueueClear}>Clear</Button>
            </> : null}
          </div>
        </div>
      </AnimatedCollapsibleContent>
    </section></Collapsible>
  );
}
