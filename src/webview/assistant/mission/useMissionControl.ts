import { useCallback } from 'react';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import { MISSION_BRIDGE_PROTOCOL_VERSION } from '../../../shared/protocol/missionProtocol';
import type { MissionMessagePoster } from './missionStart';

export type MissionUiCommand =
  | {
      readonly type: 'mission.dismissSetup';
    }
  | {
      readonly type: 'mission.panel.open';
      readonly target?: 'catalog' | 'setup';
      readonly task?: string;
    }
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
): (command: MissionUiCommand) => string {
  return useCallback(
    (command: MissionUiCommand): string => {
      const envelope = {
        protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
        requestId: createRequestId(),
        scope: 'selected-chat' as const,
      };
      let message: WebviewToHostMessage;
      if (command.type === 'mission.panel.open') {
        message = {
          ...envelope,
          type: command.type,
          ...(command.target === undefined ? {} : { target: command.target }),
          ...(command.task === undefined ? {} : { task: command.task }),
        };
      } else if (command.type === 'mission.dismissSetup') {
        message = {
          ...envelope,
          type: command.type,
          snapshotRevision: 0,
        };
      } else if (command.type === 'mission.disclosure.set') {
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
      return envelope.requestId;
    },
    [createRequestId, poster],
  );
}
