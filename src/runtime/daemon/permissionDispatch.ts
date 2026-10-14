import {
  RequestPermissionResultSchema,
  ToolConfirmationOutcome,
  type DaemonSessionController,
  type PendingPermission,
} from '@factory/droid-sdk';
import type { RetainedDaemonSession } from './sessionHandle';
import { bindDaemonAskUser } from './askUserDispatch';

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
  const inFlightPermissions = new Map<string, { replay?: PendingPermission }>();
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
  const unbindAskUser = bindDaemonAskUser(controller, handles, report, transport);
  controller.on('permissionRequested', permission);
  return () => {
    controller.off('permissionRequested', permission);
    unbindAskUser();
  };
}
