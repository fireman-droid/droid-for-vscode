import { setImmediate } from 'node:timers/promises';
import type { SessionHistoryResult } from './SessionHistory';
import { projectSessionHistorySteps } from './projectSessionHistory';

const PROJECTION_SLICE_MS = 8;

/** Keep the extension host responsive while projecting a long saved session. */
export async function projectSessionHistoryAsync(
  loaded: unknown,
  options?: { readonly workspaceRoot?: string; readonly sourceSessionId?: string },
): Promise<SessionHistoryResult> {
  const steps = projectSessionHistorySteps(loaded, options);
  let deadline = performance.now() + PROJECTION_SLICE_MS;
  let step = steps.next();
  while (!step.done) {
    if (performance.now() >= deadline) {
      await setImmediate();
      deadline = performance.now() + PROJECTION_SLICE_MS;
    }
    step = steps.next();
  }
  return step.value;
}

export function projectSessionMessagesAsync(
  messages: unknown,
  options?: { readonly workspaceRoot?: string; readonly sourceSessionId?: string },
): Promise<SessionHistoryResult> {
  return projectSessionHistoryAsync({ result: { session: { messages } } }, options);
}
