import { advance } from './turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from './types';

/** Most markdown-referenced images kept decoded in webview state. */
export const MAX_LOCAL_IMAGE_ENTRIES = 24;

export function reduceWorkspaceMessage(
  state: AssistantWebviewState,
  event: Extract<StoreHostMessage, { type: 'workspace.files' | 'workspace.imageData' }>,
): AssistantWebviewState {
  switch (event.type) {
    case 'workspace.files':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            fileSearch: {
              requestId: event.requestId,
              status: event.status,
              files: event.files,
            },
          }
        : advance(state, event.sequence);

    case 'workspace.imageData': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const entries = Object.entries(state.localImages).filter(
        ([path]) => path !== event.path,
      );
      // Insertion order doubles as recency for the byte budget.
      entries.push([
        event.path,
        {
          status: event.status,
          mediaType: event.mediaType,
          data: event.data,
        },
      ]);
      while (entries.length > MAX_LOCAL_IMAGE_ENTRIES) {
        entries.shift();
      }
      return {
        ...state,
        sequence: event.sequence,
        localImages: Object.fromEntries(entries),
      };
    }
  }
}
