import type { ChatController } from '../chat/ChatController';
import { BtwSideChat } from '../btw/btwSideChat';
import { createBtwSidecar } from '../../runtime/btw/BtwSidecar';
import { ModelAvailabilityError } from '../models/DisabledModelsStore';
import { parseReviewQuestionRequest, type ReviewQuestionResponse } from '../../shared/protocol/reviewQuestionProtocol';
import { EMPTY_SESSION_BTW_STATE } from '../../shared/protocol/btwProtocol';
import { readReviewQuestionModel, resolveReviewQuestionSelection } from './reviewQuestionSettings';
import { buildReviewQuestionContext } from './reviewQuestionPrompt';

/** Independent, tool-disabled conversation belonging only to the Review panel. */
export class ReviewQuestionHost {
  private active: { id: string; sessionId: string; context: string; chat: BtwSideChat } | null = null;
  constructor(private readonly controller: ChatController, private readonly post: (message: ReviewQuestionResponse) => void) {}

  models(sessionId: string): void {
    const catalog = this.controller.metadata.modelCatalog;
    const connection = this.controller.sessionState.connection.status;
    const offline = catalog.status === 'loading' && (connection === 'unavailable' || connection === 'idle');
    const selectedId = readReviewQuestionModel() ?? this.controller.metadata.settings.value?.modelId ?? null;
    this.post({ type: 'reviewQuestion.models', sessionId,
      status: offline || catalog.status === 'unsupported' ? 'error' : catalog.status,
      items: catalog.items.filter(item => !item.disabled).map(item => ({ id: item.id, label: item.displayName })),
      selectedId,
      error: offline ? 'Reconnect Droid in the main chat to load models.' : catalog.status === 'error' || catalog.status === 'unsupported' ? catalog.message : null,
    });
  }

  handle(value: unknown, target: { sessionId: string; root: string }): boolean {
    const request = parseReviewQuestionRequest(value);
    if (!request) return false;
    if (request.sessionId !== target.sessionId) return true;
    if (request.type === 'reviewQuestion.models') {
      this.models(target.sessionId);
      this.controller.handleMessage({ type: 'session.model-catalog.refresh', sessionId: target.sessionId });
      return true;
    }
    if (request.type === 'reviewQuestion.close') {
      if (this.active?.id === request.questionId) this.reset();
      return true;
    }
    if (request.type === 'reviewQuestion.stop') {
      if (this.active?.id === request.questionId) this.active.chat.handleStop(target.sessionId);
      return true;
    }
    const context = buildReviewQuestionContext(request.selection);
    if (this.active?.id === request.questionId && this.active.context !== context) {
      this.post({ type: 'reviewQuestion.state', sessionId: target.sessionId, questionId: request.questionId,
        state: { ...EMPTY_SESSION_BTW_STATE, status: 'error', message: 'The selected code changed. Select the code again to start a new question.' } });
      return true;
    }
    if (this.active?.id !== request.questionId) {
      this.reset();
      const id = request.questionId;
      const chat = new BtwSideChat(async (cwd, mainSessionId) => {
        const sidecar = await createBtwSidecar({ cwd, mainSessionId, readOnly: true }).catch(error => {
          this.controller.diagnostics?.record({ level: 'error', name: 'review.question.start.failed',
            detail: error instanceof Error ? error.message : String(error) });
          throw error;
        });
        return {
          ask: (text, options) => sidecar.ask(`${context}\n\nQuestion:\n${text}`, {
            ...options, ...resolveReviewQuestionSelection(this.controller.metadata.modelCatalog.items, this.controller.metadata.settings.value),
          }),
          interrupt: () => sidecar.interrupt?.() ?? Promise.resolve(),
          dispose: () => sidecar.dispose(),
        };
      }, (sessionId, state) => {
        if (this.active?.id === id) this.post({ type: 'reviewQuestion.state', sessionId, questionId: id, state });
      }, async () => {
        const modelId = readReviewQuestionModel() ?? this.controller.metadata.settings.value?.modelId;
        const catalog = this.controller.metadata.modelCatalog;
        if (!modelId || catalog.status !== 'ready' || !catalog.items.some(item => item.id === modelId && !item.disabled))
          throw new ModelAvailabilityError('The question model is unavailable. Choose a model in Settings > General > Code review questions.');
        await this.controller.modelAvailability?.assertEnabled(modelId);
        return modelId;
      });
      this.active = { id, sessionId: target.sessionId, context, chat };
    }
    const active = this.active;
    void active.chat.handleAsk(target.root, target.sessionId, request.text).catch(() => {
      if (this.active === active) this.post({ type: 'reviewQuestion.state', sessionId: target.sessionId, questionId: active.id,
        state: { ...EMPTY_SESSION_BTW_STATE, status: 'error', message: 'The question could not be sent. Try again.' } });
    });
    return true;
  }

  reset(): void { this.active?.chat.reset(); this.active = null; }
}
