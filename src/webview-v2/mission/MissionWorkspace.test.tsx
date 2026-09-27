// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MISSION_BRIDGE_PROTOCOL_VERSION, type MissionControlResultMessage, type MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../shared/protocol/missionControlPanelProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../shared/protocol/missionControlSetupProtocol';
import { MissionWorkspace as V2MissionWorkspace } from './MissionWorkspace';

const profile = { modelId: 'orchestrator-a', reasoningEffort: 'high' as const };
const inherited = { mode: 'same-as-orchestrator' as const, ...profile };
const setup: MissionControlSetupSnapshotMessage = {
  type: 'missionControl.setup.snapshot', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  sequence: 1, setupRevision: 11, workspaceAuthorityRevision: 3, chatOwnerRevision: 4,
  phase: 'advisory', availability: 'ready', reason: null, readiness: { warning: 'no_remote', level: null },
  draft: { task: 'Ship Mission parity', orchestrator: profile, worker: inherited, validator: inherited, scrutinyEnabled: true, userTestingEnabled: true },
  capabilities: {
    currentChat: profile, catalogStatus: 'ready',
    catalog: [{ id: profile.modelId, displayName: 'Orchestrator A', supportedReasoningEfforts: ['high'] }],
    preferences: { worker: inherited, validator: inherited, scrutinyEnabled: true, userTestingEnabled: true },
  },
};
const mission: MissionSnapshotMessage = {
  type: 'mission.snapshot', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION, sequence: 4,
  scope: 'selected-chat', revision: 3, availability: 'attached', lifecycle: 'running',
  title: 'Ship Mission controls',
  features: [{ id: 'first', order: 0, title: 'First feature', status: 'in_progress', workerViewAvailable: true }],
  currentFeatureId: 'first', completedFeatureCount: 0,
  controls: { canPause: true, canResume: false, canStopCurrentFeature: true },
  validator: { scrutinyEnabled: true, userTestingEnabled: true },
};
afterEach(cleanup);

describe.each([['V2', V2MissionWorkspace]] as const)('%s Mission workspace', (_version, MissionWorkspace) => {
  it('gates start on readiness and posts exact setup revision and role profiles', async () => {
    const user = userEvent.setup(), postMessage = vi.fn();
    const props = { route: 'new-mission' as const, setup, mission: null, result: null, vscode: { postMessage }, onCatalog: vi.fn(), onClose: vi.fn() };
    const view = render(<MissionWorkspace {...props} />);
    expect((screen.getByRole('button', { name: 'Start Mission' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'missionControl.setup.continue', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: expect.any(String), setupRevision: 11,
    });
    view.rerender(<MissionWorkspace {...props} setup={{ ...setup, phase: 'draft', readiness: null }} />);
    await user.click(screen.getByRole('button', { name: 'Start Mission' }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'mission.start', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
      requestId: expect.any(String), scope: 'selected-chat', ...setup.draft,
    });
    expect((screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('binds controls and worker Viewer routes to the current revision and respects the Host busy gate', async () => {
    const user = userEvent.setup(), postMessage = vi.fn();
    const props = { route: 'detail' as const, setup: null, mission, result: null, vscode: { postMessage }, onCatalog: vi.fn(), onClose: vi.fn() };
    const view = render(<MissionWorkspace {...props} />);
    let result: MissionControlResultMessage | null = null;
    const acknowledge = (action: MissionControlResultMessage['action']) => {
      const sent = postMessage.mock.lastCall?.[0];
      expect(sent).toBeDefined();
      result = {
        type: 'mission.controlResult', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
        sequence: postMessage.mock.calls.length, scope: 'selected-chat',
        requestId: sent.requestId, action, status: 'accepted',
      };
      view.rerender(<MissionWorkspace {...props} result={result} />);
    };
    expect(screen.queryByRole('button', { name: 'View', exact: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: /First feature/ }));
    await user.click(screen.getByRole('button', { name: 'Pause activity' }));
    expect((screen.getByRole('button', { name: 'Pause activity' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Stop feature' }));
    await user.click(screen.getByRole('button', { name: 'View', exact: true }));
    expect(postMessage).toHaveBeenCalledTimes(1);
    acknowledge('pause');
    await user.click(screen.getByRole('button', { name: 'Stop feature' }));
    expect(postMessage).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(postMessage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Stop feature' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop feature' }));
    acknowledge('stop-current-feature');
    await user.click(screen.getByRole('button', { name: 'View', exact: true }));
    acknowledge('open-viewer');
    const envelope = { protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION, requestId: expect.any(String), scope: 'selected-chat', snapshotRevision: 3 };
    expect(postMessage).toHaveBeenNthCalledWith(1, { ...envelope, type: 'mission.pause' });
    expect(postMessage).toHaveBeenNthCalledWith(2, { ...envelope, type: 'mission.stopCurrentFeature' });
    expect(postMessage).toHaveBeenNthCalledWith(3, { ...envelope, type: 'mission.viewer.open', featureId: 'first' });
    view.rerender(<MissionWorkspace {...props} result={result} mission={{ ...mission, controls: { ...mission.controls, busyAction: 'pause' } }} />);
    await user.click(screen.getByRole('button', { name: 'Pause activity' }));
    expect(postMessage).toHaveBeenCalledTimes(3);
    view.rerender(<MissionWorkspace {...props} result={result} mission={{ ...mission, revision: 4, controls: { canPause: false, canStopCurrentFeature: false, canResume: true } }} />);
    await user.click(screen.getByRole('button', { name: 'Resume Mission' }));
    expect(postMessage).toHaveBeenLastCalledWith({ ...envelope, snapshotRevision: 4, type: 'mission.resume' });
  });
});
