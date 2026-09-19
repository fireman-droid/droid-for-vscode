import { CollapsibleTrigger } from '../ui/collapsible';
import { useId, type ReactNode } from 'react';
import { Tool } from '../ai-elements/tool';
import { Button } from '../ui/button';
import { CommandActions, CommandOutput } from './CommandOutput';
export interface CommandCardProps {
  readonly title: string; readonly target?: string; readonly chips: readonly string[];
  readonly running: boolean; readonly failed?: boolean; readonly statusLabel?: string;
  readonly command: string; readonly output?: string; readonly open: boolean;
  readonly onOpenChange: () => void; readonly fileActions?: ReactNode;
}
export function CommandCard({ title, target, chips, running, failed, statusLabel, command, output, open, onOpenChange, fileActions }: CommandCardProps) {
  const bodyId = useId();
  return <Tool className="v2-command-card" open={open} onOpenChange={onOpenChange}>
    <header className="v2-command-head select-none">
      <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-command-toggle select-none" aria-controls={bodyId}>
        <span className="v2-command-leading" aria-hidden="true">
          <span className="v2-command-prompt-icon">&gt;_</span>
          <svg className="v2-command-chevron" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="v2-command-labels">
          <span className="v2-command-title" title={title}>{title}</span>
          {target && target !== title ? <span className="v2-command-target" title={target}>{target}</span> : null}
          {chips.length ? <span className="v2-command-chips" title={chips.join(', ')}>{chips.join(', ')}</span> : null}
        </span>
        {statusLabel ? <span className="v2-command-state" data-failed={failed}>
          {statusLabel}
        </span> : null}
      </Button></CollapsibleTrigger>
      {fileActions}
      <CommandActions command={command} running={running} />
    </header>
    <div id={bodyId} className="v2-command-body" data-state={open ? 'open' : 'closed'} aria-hidden={!open} inert={!open || undefined}>
      <div className="v2-command-body-inner">
        <CommandOutput command={command} output={output} running={running} visible={open} />
      </div>
    </div>
  </Tool>;
}
