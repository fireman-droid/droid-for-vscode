import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import {
  MISSION_BRIDGE_PROTOCOL_VERSION,
  type MissionProfile,
  type MissionReasoningEffort,
  type MissionStartMessage,
} from '../../../shared/protocol/missionProtocol';

export interface MissionSetupSubmission {
  readonly task: string;
  readonly orchestrator: {
    readonly modelId: string;
    readonly reasoningEffort: MissionReasoningEffort;
  };
  readonly worker: MissionProfile;
  readonly validator: MissionProfile;
  readonly scrutinyEnabled: boolean;
  readonly userTestingEnabled: boolean;
}

export interface PendingMissionStart {
  readonly task: string;
  readonly fromSetup: boolean;
  readonly sessionId: string;
}

export const MISSION_START_TIMEOUT_MS = 30_000;

export interface MissionMessagePoster {
  postMessage(message: WebviewToHostMessage): void;
}

export function postMissionStart(
  poster: MissionMessagePoster,
  submission: MissionSetupSubmission,
  fromSetup: boolean,
  sessionId: string,
  requests: Map<string, PendingMissionStart>,
  createRequestId: () => string,
): string | null {
  if (requests.size > 0) {
    return null;
  }
  const requestId = createRequestId();
  const message: MissionStartMessage = {
    type: 'mission.start',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId,
    scope: 'selected-chat',
    ...submission,
  };
  requests.set(requestId, { task: submission.task, fromSetup, sessionId });
  poster.postMessage(message);
  return requestId;
}

export function postMissionStartTracked(
  poster: MissionMessagePoster,
  submission: MissionSetupSubmission,
  fromSetup: boolean,
  sessionId: string,
  requests: Map<string, PendingMissionStart>,
  timers: Map<string, ReturnType<typeof setTimeout>>,
  onTimeout: (task: string) => void,
  createRequestId: () => string,
): string | null {
  const requestId = postMissionStart(
    poster,
    submission,
    fromSetup,
    sessionId,
    requests,
    createRequestId,
  );
  if (requestId === null) {
    return null;
  }
  timers.set(
    requestId,
    setTimeout(() => {
      const request = requests.get(requestId);
      if (request === undefined) {
        return;
      }
      requests.delete(requestId);
      timers.delete(requestId);
      onTimeout(request.task);
    }, MISSION_START_TIMEOUT_MS),
  );
  return requestId;
}
