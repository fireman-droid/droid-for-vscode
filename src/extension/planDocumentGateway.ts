import type {
  PermissionInteractionRequest,
  PermissionRespondMessage,
  PlanDocumentOpenMessage,
} from '../shared/bridgeMessages';

export interface PlanDocumentGateway {
  track(
    sessionId: string,
    turnId: string,
    request: PermissionInteractionRequest,
  ): void;
  open(message: PlanDocumentOpenMessage): void;
  prepareResponse(
    message: PermissionRespondMessage,
  ): PermissionRespondMessage | null;
  settle(requestId: string): void;
  replay(): void;
  dispose(): void;
}

export function createUnavailablePlanDocumentGateway(): PlanDocumentGateway {
  return {
    track() {},
    open() {},
    prepareResponse(message) {
      return message;
    },
    settle() {},
    replay() {},
    dispose() {},
  };
}
