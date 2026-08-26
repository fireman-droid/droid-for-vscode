import { describe, expect, it } from 'vitest';

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  parseMissionControlPanelHostMessage,
  parseMissionControlPanelWebviewMessage,
} from './missionControlPanelProtocol';

const request = {
  type: 'missionControl.catalog.request',
  protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  requestId: 'catalog-request-1',
  filter: 'running',
} as const;

const row = {
  catalogId: 'mission-abcdefghijklmnopqrstuvwxyz012345',
  title: 'Catalog foundation',
  lifecycle: 'running',
  workspaceLabel: 'droidvisx',
  computerLabel: 'Local workstation',
  progress: { completed: 2, total: 5 },
  createdAt: '2026-08-23T10:00:00.000Z',
  updatedAt: '2026-08-23T11:00:00.000Z',
  elapsedMs: 3_600_000,
  attached: false,
} as const;

const ready = {
  type: 'missionControl.catalog.result',
  protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  sequence: 4,
  requestId: request.requestId,
  status: 'ready',
  revision: 2,
  filter: 'running',
  rows: [row],
} as const;

const setupDraft = {
  task: 'Review  C:\\repo\\task',
  orchestrator: {
    modelId: 'factory/orchestrator',
    reasoningEffort: 'high',
  },
  worker: {
    mode: 'same-as-orchestrator',
    modelId: 'factory/orchestrator',
    reasoningEffort: 'high',
  },
  validator: {
    mode: 'override',
    modelId: 'factory/validator',
    reasoningEffort: 'medium',
  },
  scrutinyEnabled: true,
  userTestingEnabled: false,
} as const;

const credentialKeys = [
  'api-key',
  'api_key',
  'api-token',
  'api_token',
  'secret',
  'token',
  'passwd',
  'password',
  'credential',
  'authorization',
  'access-key',
  'access_key',
  'access-token',
  'access_token',
  'client-secret',
  'client_secret',
  'OPENAI_API_KEY',
] as const;

describe('Mission Control panel protocol', () => {
  it('accepts only the exact ready handshake and bounded theme broadcasts', () => {
    const readyHandshake = {
      type: 'missionControl.ready',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    } as const;
    expect(
      parseMissionControlPanelWebviewMessage(readyHandshake),
    ).toEqual(readyHandshake);
    expect(
      parseMissionControlPanelWebviewMessage({
        ...readyHandshake,
        requestId: 'unexpected',
      }),
    ).toBeUndefined();

    const theme = {
      type: 'missionControl.theme',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      preference: 'auto',
      resolved: 'dark',
    } as const;
    expect(parseMissionControlPanelHostMessage(theme)).toEqual(theme);
    expect(
      parseMissionControlPanelHostMessage({
        ...theme,
        resolved: 'sepia',
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelHostMessage({
        type: 'missionControl.route',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        route: 'catalog',
      }),
    ).toEqual({
      type: 'missionControl.route',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      route: 'catalog',
    });
  });

  it('accepts exact versioned catalog requests and official filters', () => {
    expect(parseMissionControlPanelWebviewMessage(request)).toEqual(request);
    for (const invalid of [
      { ...request, protocolVersion: 2 },
      { ...request, filter: 'failed' },
      { ...request, requestId: 'x'.repeat(129) },
      { ...request, sessionId: 'daemon-session-1' },
    ]) {
      expect(parseMissionControlPanelWebviewMessage(invalid)).toBeUndefined();
    }
  });

  it('owns setup draft updates by setup, workspace, and chat revisions', () => {
    const update = {
      type: 'missionControl.setup.update',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'setup-update-1',
      setupRevision: 3,
      workspaceAuthorityRevision: 4,
      chatOwnerRevision: 5,
      draft: setupDraft,
    } as const;
    expect(parseMissionControlPanelWebviewMessage(update)).toEqual(update);
    for (const invalid of [
      { ...update, setupRevision: -1 },
      { ...update, sessionId: 'raw-session-id' },
      { ...update, draft: { ...setupDraft, task: 'bad\u0000task' } },
      {
        ...update,
        draft: {
          ...setupDraft,
          worker: { ...setupDraft.worker, modelId: 'other-model' },
        },
      },
    ]) {
      expect(parseMissionControlPanelWebviewMessage(invalid)).toBeUndefined();
    }

    const snapshot = {
      type: 'missionControl.setup.snapshot',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      sequence: 7,
      setupRevision: 3,
      workspaceAuthorityRevision: 4,
      chatOwnerRevision: 5,
      phase: 'draft',
      availability: 'ready',
      reason: null,
      draft: setupDraft,
      capabilities: {
        currentChat: setupDraft.orchestrator,
        catalogStatus: 'ready',
        catalog: [
          {
            id: 'factory/orchestrator',
            displayName: 'Orchestrator',
            supportedReasoningEfforts: ['high'],
          },
          {
            id: 'factory/validator',
            displayName: 'Validator',
            supportedReasoningEfforts: ['medium'],
          },
        ],
        preferences: {
          worker: setupDraft.worker,
          validator: setupDraft.validator,
          scrutinyEnabled: true,
          userTestingEnabled: false,
        },
      },
    } as const;
    expect(parseMissionControlPanelHostMessage(snapshot)).toEqual(snapshot);
    expect(
      parseMissionControlPanelHostMessage({
        ...snapshot,
        cwd: 'C:\\repo',
      }),
    ).toBeUndefined();
  });

  it('accepts only safe route navigation identities', () => {
    const detail = {
      type: 'missionControl.navigate',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'navigate-detail-1',
      route: 'detail',
      catalogId: row.catalogId,
    } as const;
    expect(parseMissionControlPanelWebviewMessage(detail)).toEqual(detail);
    expect(
      parseMissionControlPanelWebviewMessage({
        ...detail,
        catalogId: 'daemon-session-raw',
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelWebviewMessage({
        ...detail,
        route: 'new-mission',
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelWebviewMessage({
        type: 'missionControl.navigate',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        requestId: 'navigate-new-1',
        route: 'new-mission',
      }),
    ).toEqual({
      type: 'missionControl.navigate',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'navigate-new-1',
      route: 'new-mission',
    });
  });

  it('accepts a bounded ready catalog and rejects unknown or secret fields', () => {
    expect(parseMissionControlPanelHostMessage(ready)).toEqual(ready);
    for (const invalid of [
      { ...ready, daemonUrl: 'ws://localhost:1234' },
      { ...ready, rows: [{ ...row, lifecycle: 'failed' }] },
      { ...ready, rows: [{ ...row, title: 'C:\\Users\\secret\\repo' }] },
      { ...ready, rows: [{ ...row, title: '/Users/secret/repo' }] },
      { ...ready, rows: [{ ...row, title: '\\\\server\\secret\\repo' }] },
      { ...ready, rows: [{ ...row, workspaceLabel: 'https://example.test/repo' }] },
      { ...ready, rows: [{ ...row, hostId: 'opaque-host-id' }] },
      { ...ready, rows: [{ ...row, workerSessionId: 'worker-secret' }] },
      { ...ready, rows: [{ ...row, title: 'x'.repeat(257) }] },
      { ...ready, rows: [{ ...row, progress: { completed: 6, total: 5 } }] },
      { ...ready, rows: [{ ...row, createdAt: 'not-a-date' }] },
    ]) {
      expect(parseMissionControlPanelHostMessage(invalid)).toBeUndefined();
    }
  });

  it.each([
    ['title', 'Investigate(C:\\Users\\alice\\secret.txt)'],
    ['title', 'Investigate(\\\\server\\share\\secret.txt)'],
    ['title', 'Investigate(/Users/alice/.ssh/id_rsa)'],
    ['title', '/mission.txt'],
    ['title', 'Investigate(/mission.txt)'],
    ['title', '/mission/path'],
    ['title', 'Investigate /mission/path'],
    ['title', '/mission-name'],
    ['title', 'Investigate[/mission-name]'],
    ['title', '/mission, continue'],
    ['title', 'Investigate(/mission)'],
    ['title', '//mission'],
    ['title', '///mission'],
    ['title', 'Investigate //mission'],
    ['workspaceLabel', '//mission'],
    ['computerLabel', 'Investigate ///mission'],
    ['title', '/workspace'],
    ['title', 'Investigate(/workspace)'],
    ['title', 'Investigate: /workspace, now'],
    ['title', 'Investigate</tmp>'],
    ['title', 'Investigate(~/secrets/key)'],
    ['title', 'api_key=super-secret-value'],
    ['title', "api_key='super-secret-value'"],
    ['title', 'api_token="super-secret-value"'],
    ['title', 'OPENAI_API_KEY=super-secret-value'],
    ['workspaceLabel', 'Workspace(/home/alice/private)'],
    ['workspaceLabel', 'password="super-secret-value"'],
    ['computerLabel', 'Computer(/var/run/private.sock)'],
    ['computerLabel', "access_token='super-secret-value'"],
    ['computerLabel', 'client_secret=super-secret-value'],
  ] as const)(
    'rejects unsafe %s presentation text',
    (property, presentation) => {
      expect(
        parseMissionControlPanelHostMessage({
          ...ready,
          rows: [{ ...row, [property]: presentation }],
        }),
      ).toBeUndefined();
    },
  );

  it('preserves legitimate bounded punctuation and slash text', () => {
    for (const title of [
      '/mission',
      '/mission Review catalog safety',
      'Investigate /mission and input/output (release 1.2)',
      'scope/mission remains an identifier',
      '𐐀/mission remains an identifier',
      'e\u0301/mission remains an identifier',
      'e\u0301/Users remains an identifier',
      'version2/mission remains an identifier',
      'scope‿/mission remains an identifier',
      'Created 2026/08/24 with ratio 3/5',
      'tokenizer=cl100k and secretariat=enabled',
      'not_client_secret=ordinary-value',
    ]) {
      expect(
        parseMissionControlPanelHostMessage({
          ...ready,
          rows: [{ ...row, title }],
        }),
      ).toMatchObject({ rows: [{ title }] });
    }
  });

  it.each([
    '/',
    '/ ',
    'Root /',
    'Root / now',
    '//',
    '///',
    'Root // now',
    'Root /// now',
  ])('rejects bare and repeated POSIX roots %s', (title) => {
    expect(
      parseMissionControlPanelHostMessage({
        ...ready,
        rows: [{ ...row, title }],
      }),
    ).toBeUndefined();
  });

  it.each([
    'scope//mission',
    '𐐀//mission',
    'e\u0301//Users',
    'version2//mission',
    'scope‿//tmp',
  ])(
    'rejects repeated slash runs after identifier continuation %s',
    (title) => {
      expect(
        parseMissionControlPanelHostMessage({
          ...ready,
          rows: [{ ...row, title }],
        }),
      ).toBeUndefined();
    },
  );

  it.each(credentialKeys)(
    'rejects quoted and unquoted %s assignments',
    (key) => {
      for (const assignment of [
        `${key}=unquoted-value`,
        `${key}='single-quoted value'`,
        `${key}="double-quoted value"`,
      ]) {
        expect(
          parseMissionControlPanelHostMessage({
            ...ready,
            rows: [{ ...row, title: assignment }],
          }),
        ).toBeUndefined();
      }
    },
  );

  it.each([
    { completed: 0, total: 0 },
    { completed: 0, total: 4 },
    { completed: 2, total: 4 },
    { completed: 4, total: 4 },
  ])('accepts valid progress $completed/$total', (progress) => {
    expect(
      parseMissionControlPanelHostMessage({
        ...ready,
        rows: [{ ...row, progress }],
      }),
    ).toBeDefined();
  });

  it.each([
    { completed: -1, total: 4 },
    { completed: Number.NaN, total: 4 },
    { completed: 1, total: Number.POSITIVE_INFINITY },
    { completed: 10_001, total: 10_001 },
  ])('rejects invalid progress $completed/$total', (progress) => {
    expect(
      parseMissionControlPanelHostMessage({
        ...ready,
        rows: [{ ...row, progress }],
      }),
    ).toBeUndefined();
  });

  it('rejects duplicate catalog identities and oversized row arrays', () => {
    expect(
      parseMissionControlPanelHostMessage({
        ...ready,
        rows: [row, { ...row, title: 'Duplicate' }],
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelHostMessage({
        ...ready,
        rows: Array.from({ length: 10_001 }, (_, index) => ({
          ...row,
          catalogId: `mission-${index}`,
        })),
      }),
    ).toBeUndefined();
  });

  it('validates exact sanitized incomplete-list failures', () => {
    const failure = {
      type: 'missionControl.catalog.result',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      sequence: 5,
      requestId: request.requestId,
      status: 'error',
      revision: 2,
      filter: 'all',
      error: {
        code: 'incomplete-list',
        message: 'The complete Mission catalog could not be loaded.',
        retryable: true,
      },
    } as const;
    expect(parseMissionControlPanelHostMessage(failure)).toEqual(failure);
    expect(
      parseMissionControlPanelHostMessage({ ...failure, rows: [row] }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelHostMessage({
        ...failure,
        error: { ...failure.error, detail: 'token=secret' },
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelHostMessage({
        ...failure,
        error: {
          ...failure.error,
          message: 'api_key=super-secret-value',
        },
      }),
    ).toBeUndefined();
    expect(
      parseMissionControlPanelHostMessage({
        ...failure,
        error: {
          ...failure.error,
          message: 'Retry after //mission',
        },
      }),
    ).toBeUndefined();
  });

  it('accepts exact bounded Webview diagnostics and rejects malformed beacons', () => {
    const diagnostic = {
      type: 'webview.diagnostic',
      kind: 'boot-timeout',
      detail: 'no boot beacon within 5000ms',
    } as const;
    expect(parseMissionControlPanelWebviewMessage(diagnostic)).toEqual(
      diagnostic,
    );
    for (const invalid of [
      { ...diagnostic, kind: 'arbitrary-kind' },
      { ...diagnostic, detail: 'x'.repeat(2_049) },
      { ...diagnostic, protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION },
      { type: 'webview.diagnostic', kind: 'boot-timeout' },
    ]) {
      expect(parseMissionControlPanelWebviewMessage(invalid)).toBeUndefined();
    }
  });
});
