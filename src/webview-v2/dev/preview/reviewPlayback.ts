import {
  parseReviewQuestionRequest,
  parseReviewQuestionResponse,
  type ReviewQuestionResponse,
} from '../../../shared/protocol/reviewQuestionProtocol';
import { MAX_BTW_ENTRIES, type BtwEntry, type SessionBtwState } from '../../../shared/protocol/btwProtocol';
import { reviewScope } from './fixtures';

export function createReviewPlayback(
  models: readonly { readonly id: string; readonly label: string }[],
  selectedId: string | null,
  failure: boolean,
  deliver: (message: ReviewQuestionResponse, current: () => boolean) => void,
) {
  let generation = 0;
  let entryId = 0;
  let active: { sessionId: string; questionId: string } | null = null;
  let entries: readonly BtwEntry[] = [];
  const timers = new Set<number>();
  function cancelTimers() {
    generation++;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  }
  function reset() {
    cancelTimers();
    active = null;
    entries = [];
  }
  function publish(message: ReviewQuestionResponse, current = () => true) {
    const parsed = parseReviewQuestionResponse(message);
    if (!parsed) throw new Error('Invalid local Review playback message');
    deliver(parsed, current);
  }
  function state(status: SessionBtwState['status'] = 'ready', message: string | null = null, stopping = false) {
    if (!active) return;
    const epoch = generation;
    publish({ type: 'reviewQuestion.state', ...active,
      state: { status, entries, message, pendingQuestion: null, stopping } }, () => epoch === generation);
  }
  function schedule(delay: number, update: () => void) {
    const epoch = generation;
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (epoch === generation) update();
    }, delay);
    timers.add(timer);
  }
  function updateLast(update: Partial<BtwEntry>) {
    entries = entries.map((entry, index) => index === entries.length - 1 ? { ...entry, ...update } : entry);
    state();
  }
  function handle(value: unknown): boolean {
    const request = parseReviewQuestionRequest(value);
    if (!request) return false;
    if (request.type === 'reviewQuestion.models') {
      publish({ type: request.type, sessionId: request.sessionId, status: failure ? 'error' : 'ready',
        items: models, selectedId: failure ? null : selectedId,
        error: failure ? 'Simulated unavailable model. No provider was contacted.' : null });
      return true;
    }
    const matches = active?.sessionId === request.sessionId && active.questionId === request.questionId;
    if (request.type === 'reviewQuestion.close') {
      if (matches) reset();
      return true;
    }
    if (request.type === 'reviewQuestion.stop') {
      if (matches && entries.some(entry => entry.state === 'streaming')) {
        cancelTimers();
        state('ready', null, true);
        schedule(150, () => updateLast({ state: 'done', stopped: true, progress: undefined }));
      }
      return true;
    }
    if (matches && entries.some(entry => entry.state === 'streaming')) return true;
    cancelTimers();
    if (!matches) entries = [];
    active = { sessionId: request.sessionId, questionId: request.questionId };
    entries = [...entries.slice(-(MAX_BTW_ENTRIES - 1)), {
      id: `preview-review-answer-${++entryId}`, question: request.text,
      answer: '', state: 'streaming', progress: 'waiting', message: null,
    }];
    if (failure || request.selection.path !== reviewScope.files[0]!.path || selectedId === null) {
      updateLast({ state: 'error', progress: undefined, message: 'This preview only supports the fixed example diff. No model or file was accessed.' });
      return true;
    }
    state();
    const introduction = '**Local simulation.** This answer uses the fixed preview diff, not a model request.\n\n';
    const explanation = 'In `src/navigation.ts`, `openPanel()` now returns `"review"` instead of `"chat"`. The `target` variable names the destination before returning it.\n\n';
    const code = '```ts\nexport function openPanel() {\n  const target = "review";\n  return target;\n}\n```\n\n';
    schedule(650, () => updateLast({ progress: 'thinking' }));
    schedule(1400, () => updateLast({ progress: 'answering', answer: introduction }));
    schedule(2300, () => updateLast({ answer: introduction + explanation }));
    schedule(3200, () => updateLast({ answer: introduction + explanation + code }));
    schedule(4100, () => updateLast({ state: 'done', progress: undefined,
      answer: introduction + explanation + code + 'You can ask a follow-up or stop the next reply to inspect its partial output. No files, Git commands or model services were used.' }));
    return true;
  }
  return { handle, reset };
}
