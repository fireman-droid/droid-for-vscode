import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  type AskUserInteractionResult,
  type AskUserInteractionRequest,
  type AskUserRespondMessage,
  type InteractionRequest,
  type PermissionInteractionRequest,
  type PermissionRespondMessage,
} from '../shared/bridgeMessages';
import {
  cancellingRuntimeInteractionHandler,
  type RuntimeAskUserRequest,
  type RuntimeAskUserResult,
  type RuntimeInteractionHandler,
  type RuntimePermissionRequest,
  type RuntimePermissionResult,
} from '../runtime/runtimeInteractions';

export const MAX_PENDING_INTERACTIONS = 16;

interface InteractionContext {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface PendingInteractionProjection extends InteractionContext {
  readonly request: InteractionRequest;
}

export interface ClosedInteractionProjection extends InteractionContext {
  readonly requestId: string;
  readonly result?: AskUserInteractionResult;
}

type PendingInteraction =
  | {
      readonly kind: 'permission';
      readonly context: InteractionContext;
      readonly request: PermissionInteractionRequest;
      readonly runtimeRequest: RuntimePermissionRequest;
      readonly resolve: (
        result:
          | RuntimePermissionResult
          | PromiseLike<RuntimePermissionResult>,
      ) => void;
    }
  | {
      readonly kind: 'ask-user';
      readonly context: InteractionContext;
      readonly request: AskUserInteractionRequest;
      readonly runtimeRequest: RuntimeAskUserRequest;
      readonly resolve: (
        result: RuntimeAskUserResult | PromiseLike<RuntimeAskUserResult>,
      ) => void;
    };

export class PendingInteractionCoordinator {
  private readonly pending = new Map<string, PendingInteraction>();
  private activeRuntime = Symbol('initial-runtime');
  private activeContext: InteractionContext | null = null;
  private requestSequence = 0;

  constructor(
    private readonly onRequest: (
      projection: PendingInteractionProjection,
    ) => void,
    private readonly onClosed: (
      projection: ClosedInteractionProjection,
    ) => void,
  ) {}

  createRuntimeHandler(): RuntimeInteractionHandler {
    const runtime = Symbol('runtime');
    this.cancelAll();
    this.activeRuntime = runtime;
    return {
      requestPermission: (request) =>
        this.requestPermissionForRuntime(runtime, request),
      askUser: (request) => this.askUserForRuntime(runtime, request),
    };
  }

  beginTurn(sessionId: string, turnId: string): void {
    if (
      this.activeContext?.sessionId === sessionId &&
      this.activeContext.turnId === turnId
    ) {
      return;
    }

    this.cancelAll();
    this.activeContext = { sessionId, turnId };
  }

  endTurn(sessionId: string, turnId: string): void {
    this.cancelTurn(sessionId, turnId);
    if (
      this.activeContext?.sessionId === sessionId &&
      this.activeContext.turnId === turnId
    ) {
      this.activeContext = null;
    }
  }

  private requestPermissionForRuntime(
    runtime: symbol,
    runtimeRequest: RuntimePermissionRequest,
  ): Promise<RuntimePermissionResult> {
    const context = this.activeContext;
    if (runtime !== this.activeRuntime || context === null) {
      return cancellingRuntimeInteractionHandler.requestPermission(
        runtimeRequest,
      );
    }

    const requestId = this.reserveRequestId();
    if (requestId === null) {
      return cancellingRuntimeInteractionHandler.requestPermission(
        runtimeRequest,
      );
    }

    const request = projectPermissionRequest(requestId, runtimeRequest);
    return new Promise<RuntimePermissionResult>((resolve) => {
      const entry: PendingInteraction = {
        kind: 'permission',
        context,
        request,
        runtimeRequest,
        resolve,
      };
      this.pending.set(requestId, entry);
      this.publish(entry);
    });
  }

  private askUserForRuntime(
    runtime: symbol,
    runtimeRequest: RuntimeAskUserRequest,
  ): Promise<RuntimeAskUserResult> {
    const context = this.activeContext;
    if (runtime !== this.activeRuntime || context === null) {
      return cancellingRuntimeInteractionHandler.askUser(runtimeRequest);
    }

    const requestId = this.reserveRequestId();
    if (requestId === null) {
      return cancellingRuntimeInteractionHandler.askUser(runtimeRequest);
    }

    const request = projectAskUserRequest(requestId, runtimeRequest);
    return new Promise<RuntimeAskUserResult>((resolve) => {
      const entry: PendingInteraction = {
        kind: 'ask-user',
        context,
        request,
        runtimeRequest,
        resolve,
      };
      this.pending.set(requestId, entry);
      this.publish(entry);
    });
  }

  respondPermission(message: PermissionRespondMessage): boolean {
    const entry = this.pending.get(message.requestId);
    if (
      entry?.kind !== 'permission' ||
      !matchesContext(entry.context, message)
    ) {
      return false;
    }

    const selectedOption = entry.request.options.find(
      ({ value }) => value === message.selectedOption,
    );
    if (
      selectedOption === undefined ||
      selectedOption.requiresEditedSpec !==
        (message.editedSpecContent !== undefined) ||
      (message.editedSpecContent !== undefined &&
        message.editedSpecContent.length > MAX_EDITED_SPEC_LENGTH)
    ) {
      return false;
    }

    const result: RuntimePermissionResult =
      message.editedSpecContent === undefined
        ? { selectedOption: message.selectedOption }
        : {
            selectedOption: message.selectedOption,
            editedSpecContent: message.editedSpecContent,
          };
    this.pending.delete(message.requestId);
    this.close(entry);
    entry.resolve(result);
    return true;
  }

  respondAskUser(message: AskUserRespondMessage): boolean {
    const entry = this.pending.get(message.requestId);
    if (
      entry?.kind !== 'ask-user' ||
      !matchesContext(entry.context, message) ||
      !isValidAskUserResponse(entry.runtimeRequest, message)
    ) {
      return false;
    }

    const result: RuntimeAskUserResult = message.cancelled
      ? { cancelled: true, answers: [] }
      : {
          answers: message.answers.map(({ index, answer }) => ({
            index,
            answer,
          })),
        };
    const projection: AskUserInteractionResult = message.cancelled
      ? { status: 'cancelled' }
      : {
          status: 'answered',
          answers: entry.runtimeRequest.questions.map((question) => ({
            topic: question.topic,
            answer:
              message.answers.find(({ index }) => index === question.index)
                ?.answer ?? '',
          })),
        };
    this.pending.delete(message.requestId);
    this.close(entry, projection);
    entry.resolve(result);
    return true;
  }

  cancelTurn(sessionId: string, turnId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (
        entry.context.sessionId === sessionId &&
        entry.context.turnId === turnId
      ) {
        this.cancel(entry);
      }
    }
  }

  cancelAll(): void {
    for (const entry of [...this.pending.values()]) {
      this.cancel(entry);
    }
    this.activeContext = null;
  }

  replayPending(): void {
    for (const entry of [...this.pending.values()]) {
      this.publish(entry);
    }
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  private reserveRequestId(): string | null {
    if (
      this.pending.size >= MAX_PENDING_INTERACTIONS ||
      this.requestSequence >= Number.MAX_SAFE_INTEGER
    ) {
      return null;
    }

    this.requestSequence += 1;
    return `interaction-${this.requestSequence}`;
  }

  private publish(entry: PendingInteraction): void {
    try {
      this.onRequest({
        ...entry.context,
        request: entry.request,
      });
    } catch {
      this.cancel(entry);
    }
  }

  private cancel(entry: PendingInteraction): void {
    if (!this.pending.delete(entry.request.requestId)) {
      return;
    }

    if (entry.kind === 'permission') {
      this.close(entry);
      entry.resolve(
        cancellingRuntimeInteractionHandler.requestPermission(
          entry.runtimeRequest,
        ),
      );
    } else {
      this.close(entry, { status: 'cancelled' });
      entry.resolve(
        cancellingRuntimeInteractionHandler.askUser(entry.runtimeRequest),
      );
    }
  }

  private close(
    entry: PendingInteraction,
    result?: AskUserInteractionResult,
  ): void {
    try {
      this.onClosed({
        ...entry.context,
        requestId: entry.request.requestId,
        ...(result === undefined ? {} : { result }),
      });
    } catch {
      // Interaction settlement must not depend on a view listener.
    }
  }
}

function projectPermissionRequest(
  requestId: string,
  request: RuntimePermissionRequest,
): PermissionInteractionRequest {
  const editableSpecContent = request.toolUses.find(
    ({ confirmationKind, editableSpecContent }) =>
      confirmationKind === 'exit_spec_mode' &&
      editableSpecContent !== undefined,
  )?.editableSpecContent;

  return {
    requestId,
    kind: 'permission',
    tools: request.toolUses.map(
      ({
        toolUseId,
        toolName,
        confirmationKind,
        title,
        detail,
        riskNote,
      }) => ({
        toolUseId,
        toolName,
        confirmationKind,
        title,
        ...(detail === undefined ? {} : { detail }),
        ...(riskNote === undefined ? {} : { riskNote }),
      }),
    ),
    options: request.options.map(
      ({ label, value, requiresEditedSpec }) => ({
        label,
        value,
        requiresEditedSpec,
      }),
    ),
    ...(editableSpecContent === undefined
      ? {}
      : { editableSpecContent }),
  };
}

function projectAskUserRequest(
  requestId: string,
  request: RuntimeAskUserRequest,
): AskUserInteractionRequest {
  return {
    requestId,
    kind: 'ask-user',
    toolCallId: request.toolCallId,
    questions: request.questions.map((question) => ({
      ...question,
      options: [...question.options],
    })),
  };
}

function isValidAskUserResponse(
  request: RuntimeAskUserRequest,
  response: AskUserRespondMessage,
): boolean {
  if (response.cancelled) {
    return response.answers.length === 0;
  }

  if (response.answers.length !== request.questions.length) {
    return false;
  }

  const expectedIndices = new Set(
    request.questions.map(({ index }) => index),
  );
  const answeredIndices = new Set<number>();
  for (const { index, answer } of response.answers) {
    if (
      answer.length === 0 ||
      answer.length > MAX_ASK_USER_ANSWER_LENGTH ||
      !expectedIndices.has(index) ||
      answeredIndices.has(index)
    ) {
      return false;
    }
    answeredIndices.add(index);
  }

  return answeredIndices.size === expectedIndices.size;
}

function matchesContext(
  context: InteractionContext,
  response: InteractionContext,
): boolean {
  return (
    context.sessionId === response.sessionId &&
    context.turnId === response.turnId
  );
}
