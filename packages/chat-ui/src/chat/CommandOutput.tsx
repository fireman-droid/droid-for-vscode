import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Ellipsis } from 'lucide-react';
import { tokenizeCommand } from './commandFormatting';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { useToolActions } from '../content/toolActions';
import { useUiEnvironment } from '../environment';

export function CommandActions({ command, running }: { readonly command: string; readonly running: boolean }) {
  const actions = useToolActions();
  const { copyText } = useUiEnvironment();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => { setOpen(false); setCopied(false); }, 900);
    return () => clearTimeout(timer);
  }, [copied]);
  return <DropdownMenu modal={false} open={open} onOpenChange={(value) => { setOpen(value); setCopied(false); setFailed(false); }}>
    <DropdownMenuTrigger asChild><Button variant="plain" size="none" className="v2-command-menu-trigger" aria-label="Command actions"><Ellipsis /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={3} className="v2-command-menu p-[3px]">
      <DropdownMenuItem className="v2-command-menu-item" onSelect={(event) => {
        event.preventDefault();
        void copyText(command).then(() => { setCopied(true); setFailed(false); }, () => setFailed(true));
      }}>{copied ? <Check /> : <Copy />}{copied ? 'Command copied' : 'Copy command'}</DropdownMenuItem>
      {running && actions.openTerminalMirror ? <DropdownMenuItem className="v2-command-menu-item" onSelect={() => actions.openTerminalMirror!()}>View in terminal</DropdownMenuItem> : null}
      {failed ? <p role="alert" className="text-xs text-destructive">Could not copy command.</p> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function CommandOutput({ command, output, running, visible = true }: {
  readonly command: string;
  readonly output: string | undefined;
  readonly running: boolean;
  readonly visible?: boolean;
}) {
  const tokens = useMemo(() => tokenizeCommand(command), [command]);
  const pre = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (visible && running && following.current && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [visible, running, output]);
  return <pre ref={pre} tabIndex={0} aria-label="Command and output" className="v2-command-well outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      onScroll={(event) => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8; }}>
      <span className="v2-command-entry">
        <span aria-hidden="true" className="v2-command-prompt">$</span>
        <code className="v2-command-code">{tokens.map((token, index) => token.kind === 'text'
          ? token.text : <span key={index} className={`v2-cmd-${token.kind}`}>{token.text}</span>)}</code>
      </span>
      {output === undefined ? null : <span className="v2-command-output">{output}</span>}
    </pre>;
}
