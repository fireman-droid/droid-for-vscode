import type { SessionHistoryLoader } from './SessionHistory';
import { projectSessionMessagesAsync } from './asyncHistoryProjection';
import { isStrictRecord } from '../../shared/validation/strictValidation';

/** Invocation boundaries are verified against saved prompt ids by the Host. */
export function scopedSessionHistory(
  loader: SessionHistoryLoader,
  firstPromptId: string | undefined,
  beforePromptId: string | undefined,
  allowedMessageIds?: ReadonlySet<string>,
): SessionHistoryLoader {
  return {
    async loadHistory(request) {
      const result = await loader.loadHistory({ ...request,
        ...(request.cursor === undefined && beforePromptId ? { cursor: beforePromptId } : {}) });
      if (result.status !== 'available' || !result.page) return result;
      const first = firstPromptId === undefined ? -1 : result.page.messages.findIndex(message =>
        isStrictRecord(message) && message.id === firstPromptId);
      const messages = (first < 0 ? result.page.messages : result.page.messages.slice(first))
        .filter(message => !allowedMessageIds || isStrictRecord(message) &&
          typeof message.id === 'string' && allowedMessageIds.has(message.id));
      const projected = await projectSessionMessagesAsync(messages, {
        workspaceRoot: request.cwd, sourceSessionId: request.sessionId,
      });
      return projected.status !== 'available' ? projected : { ...result, ...projected,
        page: { messages, nextCursor: first < 0 ? result.page.nextCursor : null } };
    },
  };
}
