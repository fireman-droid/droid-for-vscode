import { useI18n } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, SquareTerminal } from 'lucide-react';
import { tokenizeCommand } from './commandFormatting';
import { Button } from '../ui/button';
import { useToolActions } from '../content/toolActions';
import { useUiEnvironment } from '../environment';

export function CommandActions({ command, running }: { readonly command: string; readonly running: boolean }) {
  const { t } = useI18n();
  const actions = useToolActions();
  const { copyText } = useUiEnvironment();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyLabel = copied ? t("Command copied") : t("Copy command");
  return <span className="v2-command-actions">
    {failed ? <span role="alert" className="text-[11px] text-destructive">{t("Could not copy command.")}</span> : null}
    {running && actions.openTerminalMirror ? <Button variant="plain" size="none" className="v2-command-action"
      aria-label={t("View in terminal")} title={t("View in terminal")}
      onClick={() => actions.openTerminalMirror!()}><SquareTerminal aria-hidden="true" /></Button> : null}
    <Button variant="plain" size="none" className="v2-command-action" aria-label={copyLabel} title={copyLabel}
      onClick={() => { void copyText(command).then(() => { setCopied(true); setFailed(false); }, () => setFailed(true)); }}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  </span>;
}

export function CommandOutput({ command, output, running, visible = true }: {
  readonly command: string;
  readonly output: string | undefined;
  readonly running: boolean;
  readonly visible?: boolean;
}) {
  const { t } = useI18n();
  const tokens = useMemo(() => tokenizeCommand(command), [command]);
  const pre = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (visible && running && following.current && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [visible, running, output]);
  return <pre ref={pre} tabIndex={0} aria-label={t("Command and output")} className="v2-command-well outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      onScroll={(event) => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8; }}>
      <span data-ui-copy-block="" className="v2-command-entry">
        <span aria-hidden="true" className="v2-command-prompt">$</span>
        <code className="v2-command-code">{tokens.map((token, index) => token.kind === 'text'
          ? token.text : <span key={index} className={`v2-cmd-${token.kind}`}>{token.text}</span>)}</code>
      </span>
      {output === undefined ? null : <span data-ui-copy-block="" className="v2-command-output">{output}</span>}
    </pre>;
}
