import { useI18n } from '../i18n';
import type { SideConversation } from './sideChat';
import { DroidActivity } from '../ui/droid-motion';
import { AssistantMessage } from './AssistantMessage';
import { ReplyView } from './ReplyView';
import { ThinkingView } from './ThinkingView';

const PROGRESS_LABELS = {
  waiting: 'Waiting for reply…', thinking: 'Thinking…', tool: 'Using tools…', answering: 'Receiving reply…',
};

export function SideReply({ entry, preparing }: { readonly entry: SideConversation['entries'][number]; readonly preparing: boolean }) {
  const { t } = useI18n();
  const running = entry.state === 'streaming';
  const progress = entry.progress ?? (entry.answer ? 'answering' : 'waiting');
  const thinking = running && progress === 'thinking';
  const receivedThinking = entry.thinking !== undefined || entry.thinkingDurationMs !== undefined;
  return <ReplyView replyText={entry.answer || undefined} running={running} readOnly showTimestamp={false}>
    {receivedThinking || thinking ? <ThinkingView text={entry.thinking ?? ''}
      status={thinking ? 'active' : entry.state === 'error' ? 'incomplete' : 'complete'}
      durationMs={entry.thinkingDurationMs} truncated={entry.thinkingTruncated} /> : null}
    {entry.answer ? <AssistantMessage text={entry.answer} streaming={running} /> : null}
    {running && !preparing && !thinking ? <p role="status" aria-live="polite" className="v2-btw-progress">
      <DroidActivity phase={progress === 'waiting' ? 'loading' : 'working'} />
      {t(PROGRESS_LABELS[progress])}
    </p> : null}
  </ReplyView>;
}
