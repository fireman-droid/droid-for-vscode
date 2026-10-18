import { useI18n } from '../i18n';
import { memo, useEffect, useState } from 'react';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { ActivityItem } from './ActivityItem';
import { ThinkingBody } from './ThinkingBody';
import { formatThinkingLabel } from './thinkingLabel';

export const ThinkingView = memo(function ThinkingView({ text, status, durationMs, truncated = false, activity }: {
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
  const body = <ThinkingBody text={text} running={running} truncated={truncated} />;
  if (activity) return <ActivityItem {...activity} textSelectable={false} icon={null} title={title}
    status={truncated ? t('Safety limit') : running ? waiting ? t('Waiting') : t('Receiving') : undefined}>{body}</ActivityItem>;
  return <Tool open={expanded} onOpenChange={setExpanded}>
    <ToolHeader className="select-none" title={title}
      status={truncated ? t('Safety limit reached') : running ? waiting ? t('Waiting for model') : t('Receiving') : ''} />
    <ToolContent className="pb-1">{body}</ToolContent>
  </Tool>;
});
