import { isExecuteToolName } from '../../shared/toolOutput';
import type { RuntimeEvent } from '../../runtime/runtimeEvents';
import type { ChatControllerInternals } from './internals';

/**
 * Feeds execute-tool lifecycle and output into the read-only terminal
 * mirror. This runs inside the current-turn event gate, so history
 * replays never pass through it.
 */
export function mirrorExecuteEvent(
  ctl: ChatControllerInternals,
  sessionId: string,
  event: Extract<
    RuntimeEvent,
    { type: 'tool-start' | 'tool-progress' | 'tool-result' }
  >,
): void {
  const mirror = ctl.terminalMirror;
  if (mirror === undefined || !isExecuteToolName(event.toolName)) {
    return;
  }
  switch (event.type) {
    case 'tool-start':
      mirror.commandStarted({
        toolUseId: event.toolUseId,
        ...(event.detailKind === 'command' &&
        event.detail !== undefined
          ? { command: event.detail }
          : {}),
        sessionTag: sessionId.slice(0, 8),
      });
      return;
    case 'tool-progress':
      if (event.outputTail !== undefined) {
        mirror.commandOutput(event.toolUseId, event.outputTail);
      }
      return;
    case 'tool-result':
      mirror.commandSettled(event.toolUseId);
      return;
  }
}
