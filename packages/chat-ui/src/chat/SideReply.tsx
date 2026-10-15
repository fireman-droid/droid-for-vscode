import { useI18n } from '../i18n';
import type { SideConversation } from './sideChat';
import { DroidActivity } from '../ui/droid-motion';
import { AssistantMessage } from './AssistantMessage';
import { ReplyView } from './ReplyView';
import { ThinkingView } from './ThinkingView';
import { SideAnalysisResults, SideToolRecords } from './SideToolRecords';

const PROGRESS_LABELS = {
  waiting: 'Waiting for reply…', thinking: 'Thinking…', tool: 'Using tools…', answering: 'Receiving reply…',
};

export function SideReply({ entry, preparing }: { readonly entry: SideConversation['entries'][number]; readonly preparing: boolean }) {
  const { t } = useI18n();
  const running = entry.state === 'streaming';
  const progress = entry.progress ?? (entry.answer ? 'answering' : 'waiting');
  const thinking = running && progress === 'thinking';
  const receivedThinking = entry.thinking !== undefined || entry.thinkingDurationMs !== undefined;
  const tools = entry.tools ?? [];
  const activity = tools.filter(tool => tool.kind !== 'analysis' || tool.state === 'running');
  const hasActiveTool = tools.some(tool => tool.state === 'running');
  const activityProgress = running && !thinking && !hasActiveTool
    ? { label: t(preparing ? 'Preparing' : PROGRESS_LABELS[progress]), loading: preparing || progress === 'waiting' } : undefined;
  return <ReplyView replyText={entry.answer || undefined} running={running} readOnly showTimestamp={false}>
    {receivedThinking || thinking ? <ThinkingView text={entry.thinking ?? ''}
      status={thinking ? 'active' : entry.state === 'error' ? 'incomplete' : 'complete'}
      durationMs={entry.thinkingDurationMs} truncated={entry.thinkingTruncated} /> : null}
    <SideToolRecords tools={activity} progress={activityProgress} />
    {activityProgress && !activity.length ? <p role="status" aria-live="polite" className="v2-btw-progress">
      <DroidActivity phase={preparing || progress === 'waiting' ? 'loading' : 'working'} />
      {t(preparing ? 'Preparing' : PROGRESS_LABELS[progress])}
    </p> : null}
    {entry.answer ? <AssistantMessage text={entry.answer} streaming={running} /> : null}
    <SideAnalysisResults tools={tools.filter(tool => tool.kind === 'analysis' && tool.state !== 'running')} />
    {entry.stopped ? <p role="status" className="text-[11px] text-muted-foreground">{t('Stopped')}</p> : null}
  </ReplyView>;
}
