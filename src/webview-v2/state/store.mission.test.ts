import { describe, expect, it } from 'vitest';

import type { MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import { assistantWebviewReducer } from './store';
import { initialAssistantWebviewState } from './initialState';

const setupSnapshot: MissionSnapshotMessage = {
  type: 'mission.snapshot',
  protocolVersion: 25,
  sequence: 1,
  scope: 'selected-chat',
  revision: 0,
  availability: 'attached',
  features: [],
  completedFeatureCount: 0,
  controls: {
    canPause: false,
    canResume: false,
    canStopCurrentFeature: false,
  },
  validator: {
    scrutinyEnabled: true,
    userTestingEnabled: true,
  },
  setup: {
    currentChat: { modelId: 'model-a', reasoningEffort: 'high' },
    catalogStatus: 'ready',
    catalog: [
      {
        id: 'model-a',
        displayName: 'Model A',
        supportedReasoningEfforts: ['medium', 'high'],
      },
    ],
    preferences: {
      worker: {
        mode: 'same-as-orchestrator',
        modelId: 'model-a',
        reasoningEffort: 'high',
      },
      validator: {
        mode: 'same-as-orchestrator',
        modelId: 'model-a',
        reasoningEffort: 'high',
      },
      scrutinyEnabled: true,
      userTestingEnabled: true,
    },
  },
};

describe('Mission Webview store', () => {
  it('stores setup capabilities and correlated results additively', () => {
    const withSetup = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: setupSnapshot,
    });
    expect(withSetup.missionSnapshot).toEqual(setupSnapshot);
    expect(withSetup.transcript).toBe(initialAssistantWebviewState.transcript);

    const withResult = assistantWebviewReducer(withSetup, {
      type: 'host.message',
      message: {
        type: 'mission.controlResult',
        protocolVersion: 25,
        sequence: 2,
        scope: 'selected-chat',
        requestId: 'request-1',
        action: 'start',
        status: 'rejected',
        rejectionCode: 'invalid',
      },
    });
    expect(withResult.missionControlResult).toMatchObject({
      requestId: 'request-1',
      status: 'rejected',
    });
    expect(withResult.missionSnapshot).toBe(withSetup.missionSnapshot);
  });
});
