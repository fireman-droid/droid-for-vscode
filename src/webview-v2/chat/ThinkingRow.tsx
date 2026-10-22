import type { ThinkingTranscriptItem } from '../../shared/protocol/transcript';
import { ThinkingView } from '@droidvisx/chat-ui/chat/ThinkingView';
import { memo, useMemo } from 'react';

export const ThinkingRow = memo(function ThinkingRow({ item, messageId, grouped, streaming }: { readonly item: ThinkingTranscriptItem; readonly messageId: string; readonly grouped: boolean; readonly streaming: boolean }) {
  const activity = useMemo(() => grouped ? { id: item.id, messageId } : undefined, [grouped, item.id, messageId]);
  return <ThinkingView text={item.text} status={item.status === 'active' && streaming ? 'active' : item.status === 'complete' ? 'complete' : 'incomplete'}
    durationMs={item.durationMs} truncated={item.truncated} activity={activity} />;
});
