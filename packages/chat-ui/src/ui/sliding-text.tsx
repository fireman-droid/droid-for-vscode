import { useState } from 'react';
import { cn } from './cn';

/** A single-line replacement: the old text leaves upward as the latest enters below. */
export function SlidingText({ text, className }: { readonly text: string; readonly className?: string }) {
  const [frame, setFrame] = useState<{ current: string; previous?: string; revision: number }>({
    current: text, revision: 0,
  });
  // Unrelated renders must not restart motion; rapid updates replace the outgoing frame.
  if (frame.current !== text) {
    setFrame({ current: text, previous: frame.current, revision: frame.revision + 1 });
  }
  return <span className={cn('dvx-sliding-text', className)} title={text}>
    {frame.previous !== undefined ? <span key={`out-${frame.revision}`} aria-hidden="true"
      className="dvx-sliding-text-line dvx-sliding-text-out">{frame.previous}</span> : null}
    <span key={`in-${frame.revision}`} className="dvx-sliding-text-line"
      data-entering={frame.previous !== undefined || undefined}
      onAnimationEnd={() => setFrame((current) => current.revision === frame.revision
        ? { current: current.current, revision: current.revision } : current)}>{frame.current}</span>
  </span>;
}
