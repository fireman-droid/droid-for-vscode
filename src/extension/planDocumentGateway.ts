import type {
  PermissionInteractionRequest,
  PermissionRespondMessage,
  PlanDocumentOpenMessage,
  PlanDocumentStateMessage,
} from '../shared/bridgeMessages';

export type PlanDocumentStateProjection = Omit<
  PlanDocumentStateMessage,
  'sequence'
>;

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
  replayTo(
    listener: (state: PlanDocumentStateProjection) => void,
  ): void;
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
    replayTo() {},
    dispose() {},
  };
}
