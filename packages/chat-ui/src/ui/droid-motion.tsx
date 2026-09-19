import type { CSSProperties } from 'react';
import { cn } from './cn';

const pixelSteps = [0, 1, 2, 7, 8, 3, 6, 5, 4];

export function DroidActivity({ phase = 'working', large = false, className }: {
  readonly phase?: 'working' | 'thinking' | 'loading';
  readonly large?: boolean;
  readonly className?: string;
}) {
  return <span aria-hidden="true" className={cn('droid-activity', large && 'droid-activity-large', className)} data-phase={phase}>
    {pixelSteps.map((step, index) => <span key={index} className="droid-pixel" style={{ '--droid-step': step } as CSSProperties} />)}
  </span>;
}

export function DroidConnectionDot({ state, working }: {
  readonly state: 'connected' | 'connecting' | 'unavailable' | 'idle';
  readonly working: boolean;
}) {
  return <span aria-hidden="true" className="droid-connection-dot" data-state={state} data-working={state === 'connected' && working} />;
}

export function DroidLoading({ label, detail, className }: {
  readonly label: string;
  readonly detail?: string;
  readonly className?: string;
}) {
  return <div role="status" className={cn('droid-loading', className)}>
    <DroidActivity phase="loading" large />
    <div className="droid-loading-copy">
      <p className="droid-loading-label">{label}</p>
      {detail ? <p className="droid-loading-detail">{detail}</p> : null}
    </div>
  </div>;
}
