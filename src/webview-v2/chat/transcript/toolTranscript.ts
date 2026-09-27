import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../../shared/protocol/bounds';
import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { type ToolActivityMessage } from '../../../shared/bridgeMessages';
import { projectToolFields } from '../../../shared/transcript/toolFields';

export function upsertTool(
  transcript: readonly SessionTranscriptItem[],
  event: ToolActivityMessage,
): readonly SessionTranscriptItem[] {
  const index = transcript.findIndex(
    (item) =>
      item.kind === 'tool' &&
      item.turnId === event.turnId &&
      item.toolUseId === event.toolUseId,
  );
  if (index !== -1) {
    return transcript.map((item, itemIndex) => {
      if (itemIndex !== index || item.kind !== 'tool') return item;
      if (
        event.status === 'running' &&
        (item.status === 'completed' ||
          item.status === 'failed' ||
          item.status === 'stopped')
      )
        return item;
      return {
        ...item,
        ...projectToolFields(event, item),
      };
    });
  }
  if (
    transcript.filter((item) => item.kind === 'tool' && item.turnId === event.turnId)
      .length >= MAX_TOOL_ACTIVITIES_PER_TURN
  )
    return transcript;
  return [
    ...transcript,
    {
      id: `tool:${event.turnId}:${event.toolUseId}`,
      kind: 'tool',
      ...projectToolFields(event),
    },
  ];
}
