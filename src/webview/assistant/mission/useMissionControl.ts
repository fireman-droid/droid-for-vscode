import { useCallback } from 'react';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import { MISSION_BRIDGE_PROTOCOL_VERSION } from '../../../shared/missionProtocol';
import type { MissionMessagePoster } from './missionStart';

export type MissionUiCommand =
  | {
      readonly type:
        | 'mission.pause'
        | 'mission.resume'
        | 'mission.stopCurrentFeature'
        | 'mission.refresh';
      readonly revision: number;
    }
  | {
      readonly type: 'mission.disclosure.set';
      readonly expanded: boolean;
    }
  | {
      readonly type: 'mission.viewer.open';
      readonly revision: number;
      readonly featureId: string;
    };

export function useMissionControl(
  poster: MissionMessagePoster,
  createRequestId: () => string,
): (command: MissionUiCommand) => void {
  return useCallback(
    (command: MissionUiCommand): void => {
      const envelope = {
        protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
        requestId: createRequestId(),
        scope: 'selected-chat' as const,
      };
      let message: WebviewToHostMessage;
      if (command.type === 'mission.disclosure.set') {
        message = { ...envelope, type: command.type, expanded: command.expanded };
      } else if (command.type === 'mission.viewer.open') {
        message = {
          ...envelope,
          type: command.type,
          snapshotRevision: command.revision,
          featureId: command.featureId,
        };
      } else {
        message = {
          ...envelope,
          type: command.type,
          snapshotRevision: command.revision,
        };
      }
      poster.postMessage(message);
    },
    [createRequestId, poster],
  );
}
