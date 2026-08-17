import { describe, expect, it } from 'vitest';

import {
  MISSION_BRIDGE_PROTOCOL_VERSION,
  parseMissionHostMessage,
  parseMissionWebviewMessage,
} from './missionProtocol';

const BRIDGE_PROTOCOL_VERSION = MISSION_BRIDGE_PROTOCOL_VERSION;

const startIntent = {
  type: 'mission.start',
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  requestId: 'request-1',
  scope: 'selected-chat',
  task: 'Add mission controls.',
  orchestrator: { modelId: 'model-orchestrator', reasoningEffort: 'high' },
  worker: {
    mode: 'same-as-orchestrator',
    modelId: 'model-orchestrator',
    reasoningEffort: 'high',
  },
  validator: {
    mode: 'override',
    modelId: 'model-validator',
    reasoningEffort: 'medium',
  },
  scrutinyEnabled: true,
  userTestingEnabled: true,
} as const;

describe('Mission Bridge protocol', () => {
  it('validates bounded Mission setup intents', () => {
    expect(parseMissionWebviewMessage(startIntent)).toEqual(startIntent);

    for (const hostile of [
      { ...startIntent, sessionId: 'other-session' },
      { ...startIntent, worker: { ...startIntent.worker, sdk: {} } },
      { ...startIntent, scrutinyModel: 'separate-model' },
      { ...startIntent, task: 'x'.repeat(20_001) },
      { ...startIntent, protocolVersion: BRIDGE_PROTOCOL_VERSION + 1 },
      { ...startIntent, worker: { ...startIntent.worker, modelId: 'other' } },
      { ...startIntent, callback: () => undefined },
      { ...startIntent, task: 'C:\\Users\\secret\\task' },
    ]) {
      expect(parseMissionWebviewMessage(hostile)).toBeUndefined();
    }
  });

  it('validates exact Mission control intents', () => {
    expect(
      parseMissionWebviewMessage({
        type: 'mission.stopCurrentFeature',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: 'request-2',
        scope: 'selected-chat',
        snapshotRevision: 4,
      }),
    ).toEqual({
      type: 'mission.stopCurrentFeature',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId: 'request-2',
      scope: 'selected-chat',
      snapshotRevision: 4,
    });
    expect(
      parseMissionWebviewMessage({
        type: 'mission.stopCurrentFeature',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: 'request-2',
        scope: 'selected-chat',
        snapshotRevision: 4,
        workerSessionId: 'worker-1',
      }),
    ).toBeUndefined();
  });

  it('accepts only safe authoritative Mission snapshots', () => {
    const snapshot = {
      type: 'mission.snapshot',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      sequence: 7,
      scope: 'selected-chat',
      revision: 7,
      availability: 'attached',
      lifecycle: 'running',
      features: [
        {
          id: 'feature-1',
          order: 0,
          title: 'Implement protocol',
          status: 'in_progress',
          workerViewAvailable: true,
        },
      ],
      currentFeatureId: 'feature-1',
      completedFeatureCount: 0,
      controls: {
        canPause: true,
        canResume: false,
        canStopCurrentFeature: true,
      },
      validator: {
        scrutinyEnabled: true,
        userTestingEnabled: true,
      },
    } as const;

    expect(parseMissionHostMessage(snapshot)).toEqual(snapshot);
    expect(
      parseMissionHostMessage({
        ...snapshot,
        workerSessionId: 'worker-secret',
      }),
    ).toBeUndefined();
    expect(
      parseMissionHostMessage({
        ...snapshot,
        completedFeatureCount: 1,
      }),
    ).toBeUndefined();
    expect(
      parseMissionHostMessage({
        ...snapshot,
        features: [
          {
            ...snapshot.features[0],
            description: 'C:\\Users\\secret\\project',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('accepts a bounded Mission setup capability projection', () => {
    const snapshot = {
      type: 'mission.snapshot',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      sequence: 9,
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
        scrutinyEnabled: false,
        userTestingEnabled: true,
      },
      setup: {
        currentChat: {
          modelId: 'model-orchestrator',
          reasoningEffort: 'high',
        },
        catalogStatus: 'ready',
        catalog: [
          {
            id: 'model-orchestrator',
            displayName: 'Orchestrator',
            supportedReasoningEfforts: ['medium', 'high'],
          },
        ],
        preferences: {
          worker: {
            mode: 'same-as-orchestrator',
            modelId: 'model-orchestrator',
            reasoningEffort: 'high',
          },
          validator: {
            mode: 'override',
            modelId: 'model-orchestrator',
            reasoningEffort: 'medium',
          },
          scrutinyEnabled: false,
          userTestingEnabled: true,
        },
      },
    } as const;

    expect(parseMissionHostMessage(snapshot)).toEqual(snapshot);
    expect(
      parseMissionHostMessage({
        ...snapshot,
        setup: {
          ...snapshot.setup,
          cwd: 'C:\\workspace',
        },
      }),
    ).toBeUndefined();
    expect(
      parseMissionHostMessage({
        ...snapshot,
        setup: {
          ...snapshot.setup,
          catalog: [
            {
              ...snapshot.setup.catalog[0],
              token: 'secret',
            },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it('bounds correlated Mission control results', () => {
    expect(
      parseMissionHostMessage({
        type: 'mission.controlResult',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        sequence: 8,
        scope: 'selected-chat',
        requestId: 'request-2',
        action: 'pause',
        status: 'rejected',
        rejectionCode: 'stale',
      }),
    ).toEqual({
      type: 'mission.controlResult',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      sequence: 8,
      scope: 'selected-chat',
      requestId: 'request-2',
      action: 'pause',
      status: 'rejected',
      rejectionCode: 'stale',
    });
    expect(
      parseMissionHostMessage({
        type: 'mission.controlResult',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        sequence: 8,
        scope: 'selected-chat',
        requestId: 'request-2',
        action: 'sessions.killWorker',
        status: 'accepted',
      }),
    ).toBeUndefined();
  });
});
