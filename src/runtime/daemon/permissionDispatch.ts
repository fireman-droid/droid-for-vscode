import {
  AskUserResultSchema,
  RequestPermissionResultSchema,
  ToolConfirmationOutcome,
  type DaemonSessionController,
  type PendingAskUserRequest,
  type PendingPermission,
} from '@factory/droid-sdk';
import type { RetainedDaemonSession } from './sessionHandle';

export interface InteractionTransport {
  waitUntilReady(): Promise<void>;
  revision(): number;
  isReady(): boolean;
}

export function bindDaemonInteractions(
  controller: DaemonSessionController,
  handles: ReadonlyMap<string, RetainedDaemonSession>,
  onError: (error: Error) => void,
  transport: InteractionTransport = {
    waitUntilReady: async () => {}, revision: () => 0, isReady: () => true,
  },
): () => void {
  const report = (error: unknown, owner?: RetainedDaemonSession): void => {
    const failure =
      error instanceof Error ? error : new Error('Daemon interaction failed');
    owner?.reportError(failure);
    onError(failure);
  };
  const reportResponse = (error: unknown, revision: number | undefined, owner?: RetainedDaemonSession): boolean => {
    // An ambiguous response during transport loss belongs to the recovery
    // coordinator. Do not turn it into an instruction to interrupt the worker.
    const current = revision !== undefined && transport.isReady() && revision === transport.revision();
    report(error, current ? owner : undefined);
    return !current;
  };
  const dispatchPermission = async (request: PendingPermission): Promise<boolean> => {
    const owner =
      handles.get(request.sessionId) ??
      request.associatedSessionIds
        .map((id) => handles.get(id))
        .find((handle) => handle !== undefined);
    const sessionId = owner?.id ?? request.sessionId;
    let result: {
      selectedOption: ToolConfirmationOutcome;
      comment?: string;
      editedSpecContent?: string;
    } = {
      selectedOption: ToolConfirmationOutcome.Cancel,
    };
    const handler = owner?.handlers.permissionHandler;
    if (handler !== undefined) {
      try {
        const value = await handler({
          toolUses: request.toolUses,
          options: request.options,
          associatedSessionIds: request.associatedSessionIds,
        });
        const parsed = RequestPermissionResultSchema.parse(
          typeof value === 'string' ? { selectedOption: value } : value,
        );
        if (!request.options.some((option) => option.value === parsed.selectedOption)) {
          throw new Error('Permission handler selected an unavailable option');
        }
        result = parsed;
      } catch (error) {
        report(error, owner);
      }
    }
    let revision: number | undefined;
    try {
      // A user can answer while the socket is recovering. Hold the unsent
      // response until its original session subscription is restored.
      await transport.waitUntilReady();
      revision = transport.revision();
      await controller.respondToPermission({
        permissionId: request.requestId,
        sessionId,
        ...result,
      });
      return false;
    } catch (error) {
      return reportResponse(error, revision, owner);
    }
  };
  const dispatchAskUser = async (request: PendingAskUserRequest): Promise<boolean> => {
    const owner = handles.get(request.sessionId);
    let result = AskUserResultSchema.parse({ cancelled: true, answers: [] });
    const handler = owner?.handlers.askUserHandler;
    if (handler !== undefined) {
      try {
        result = AskUserResultSchema.parse(
          await handler({
            toolCallId: request.toolCallId,
            questions: request.questions,
          }),
        );
      } catch (error) {
        report(error, owner);
      }
    }
    let revision: number | undefined;
    try {
      await transport.waitUntilReady();
      revision = transport.revision();
      await controller.respondToAskUser({
        requestId: request.requestId,
        sessionId: request.sessionId,
        result,
      });
      return false;
    } catch (error) {
      return reportResponse(error, revision, owner);
    }
  };
  const inFlightPermissions = new Map<string, { replay?: PendingPermission }>();
  const inFlightQuestions = new Map<string, { replay?: PendingAskUserRequest }>();
  const once = async <T extends { requestId: string }>(
    request: T, inFlight: Map<string, { replay?: T }>, dispatch: (value: T) => Promise<boolean>,
    isPending: () => boolean,
  ): Promise<void> => {
    const existing = inFlight.get(request.requestId);
    if (existing) { existing.replay = request; return; }
    const state: { replay?: T } = {};
    inFlight.set(request.requestId, state);
    try {
      let current = request;
      while (true) {
        state.replay = undefined;
        const uncertain = await dispatch(current);
        // A reload can replay the pending request before the old RPC rejects.
        // Re-ask only that confirmed pending request; never resend its old answer.
        if (!uncertain || !state.replay || !isPending()) break;
        current = state.replay;
      }
    }
    finally { inFlight.delete(request.requestId); }
  };
  // Reloading the subscription can re-emit a question whose answer is already
  // waiting above. Keep one UI request and one response submission in flight.
  const permission = (request: PendingPermission) => once(request, inFlightPermissions, dispatchPermission,
    () => controller.getPendingPermissions().some(value => value.requestId === request.requestId));
  const askUser = (request: PendingAskUserRequest) => once(request, inFlightQuestions, dispatchAskUser,
    () => controller.getPendingAskUserRequests().some(value => value.requestId === request.requestId));
  controller.on('permissionRequested', permission);
  controller.on('askUserRequested', askUser);
  return () => {
    controller.off('permissionRequested', permission);
    controller.off('askUserRequested', askUser);
  };
}
