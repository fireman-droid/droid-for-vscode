import {
  AskUserResultSchema,
  RequestPermissionResultSchema,
  ToolConfirmationOutcome,
  type DaemonSessionController,
  type PendingAskUserRequest,
  type PendingPermission,
} from '@factory/droid-sdk';
import type { RetainedDaemonSession } from './sessionHandle';

export function bindDaemonInteractions(
  controller: DaemonSessionController,
  handles: ReadonlyMap<string, RetainedDaemonSession>,
  onError: (error: Error) => void,
): () => void {
  const report = (error: unknown, owner?: RetainedDaemonSession): void => {
    const failure =
      error instanceof Error ? error : new Error('Daemon interaction failed');
    owner?.reportError(failure);
    onError(failure);
  };
  const permission = async (request: PendingPermission): Promise<void> => {
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
    try {
      await controller.respondToPermission({
        permissionId: request.requestId,
        sessionId,
        ...result,
      });
    } catch (error) {
      report(error, owner);
    }
  };
  const askUser = async (request: PendingAskUserRequest): Promise<void> => {
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
    try {
      await controller.respondToAskUser({
        requestId: request.requestId,
        sessionId: request.sessionId,
        result,
      });
    } catch (error) {
      report(error, owner);
    }
  };
  controller.on('permissionRequested', permission);
  controller.on('askUserRequested', askUser);
  return () => {
    controller.off('permissionRequested', permission);
    controller.off('askUserRequested', askUser);
  };
}
