import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { Markdown } from '../content/Markdown';
import { ActivityItem } from './ActivityItem';
import { formatThinkingLabel } from './thinkingLabel';

export function ThinkingView({ text, status, durationMs, truncated = false, activity }: {
  readonly text: string;
  readonly status: 'active' | 'complete' | 'incomplete';
  readonly durationMs?: number;
  readonly truncated?: boolean;
  readonly activity?: { readonly id: string; readonly messageId: string };
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const running = status === 'active';
  useEffect(() => {
    setWaiting(false);
    if (!running || truncated) return;
    const timer = setTimeout(() => setWaiting(true), 10_000);
    return () => clearTimeout(timer);
  }, [running, text.length, truncated]);
  const title = running ? t('Thinking') : formatThinkingLabel(status, durationMs ?? null, t);
  const body = <div className="v2-thinking-detail select-none text-muted-foreground [&_*]:select-none">
    {text ? <Markdown text={text.replace(/(?<=\S)\*{4}(?=\S)/gu, '**\n\n**')} streaming={running} thinking />
      : <p role="status">{running ? t("Waiting for thinking text…") : t("No thinking text returned.")}</p>}
    {truncated ? <p role="note" className="mt-2 text-[11px]">{t("Thinking reached the local safety limit; later reasoning is not retained.")}</p> : null}
  </div>;
  if (activity) return <ActivityItem {...activity} textSelectable={false} icon={<Brain />} title={title}
    status={truncated ? t('Safety limit') : running ? waiting ? t('Waiting') : t('Receiving') : undefined}>{body}</ActivityItem>;
  return <Tool open={expanded} onOpenChange={setExpanded}>
    <ToolHeader className="select-none" title={title}
      status={truncated ? t('Safety limit reached') : running ? waiting ? t('Waiting for model') : t('Receiving') : ''} />
    <ToolContent className="pb-1">{body}</ToolContent>
  </Tool>;
}
