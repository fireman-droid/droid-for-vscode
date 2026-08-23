import type { SessionTranscriptItem } from '../shared/bridgeMessages';

export function transcriptItemKey(item: SessionTranscriptItem): string {
  switch (item.kind) {
    case 'user':
    case 'assistant':
    case 'thinking':
      return JSON.stringify([item.kind, item.text]);
    case 'tool':
      return JSON.stringify([item.kind, item.toolName, item.action]);
    case 'changes':
      return JSON.stringify([
        item.kind,
        item.files.map((file) => file.path),
      ]);
    case 'ask-user-result':
      return JSON.stringify([
        item.kind,
        item.status,
        item.status === 'answered'
          ? item.answers.map(({ topic, answer }) => [topic, answer])
          : null,
      ]);
    case 'diagnostic':
      return JSON.stringify([
        item.kind,
        item.severity,
        item.code,
        item.message,
      ]);
    // Recovered image placeholders and loaded images share an identity.
    case 'image':
      return JSON.stringify([
        item.kind,
        item.origin,
        item.mediaType,
        item.byteLength,
        item.generated,
      ]);
  }
}
