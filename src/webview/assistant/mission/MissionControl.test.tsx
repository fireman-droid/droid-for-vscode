// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MissionSnapshotMessage } from '../../../shared/missionProtocol';
import { MissionControl } from './MissionControl';

const snapshot: MissionSnapshotMessage = {
  type: 'mission.snapshot',
  protocolVersion: 25,
  sequence: 4,
  scope: 'selected-chat',
  revision: 3,
  availability: 'attached',
  lifecycle: 'running',
  title: 'Ship Mission controls',
  features: [
    {
      id: 'first',
      order: 0,
      title: 'First feature',
      status: 'in_progress',
      workerViewAvailable: true,
    },
    {
      id: 'second',
      order: 1,
      title: 'Second feature',
      status: 'completed',
    },
  ],
  currentFeatureId: 'first',
  completedFeatureCount: 1,
  controls: {
    canPause: true,
    canResume: false,
    canStopCurrentFeature: true,
  },
  validator: {
    scrutinyEnabled: true,
    userTestingEnabled: true,
  },
};

afterEach(cleanup);

describe('MissionControl', () => {
  it('renders ordered progress and posts revision-bound controls', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<MissionControl snapshot={snapshot} onCommand={onCommand} />);

    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'First featureView worker',
      'Second feature',
    ]);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '1',
    );
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(
      screen.getByRole('button', { name: 'Stop current feature' }),
    );
    await user.click(screen.getByRole('button', { name: 'View worker' }));
    expect(onCommand).toHaveBeenNthCalledWith(1, {
      type: 'mission.pause',
      revision: 3,
    });
    expect(onCommand).toHaveBeenNthCalledWith(2, {
      type: 'mission.stopCurrentFeature',
      revision: 3,
    });
    expect(onCommand).toHaveBeenNthCalledWith(3, {
      type: 'mission.viewer.open',
      revision: 3,
      featureId: 'first',
    });
  });

  it('collapses without remounting the surrounding chat', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<MissionControl snapshot={snapshot} onCommand={onCommand} />);
    await user.click(
      screen.getByRole('button', { name: /Ship Mission controls/ }),
    );
    expect(screen.queryByRole('list')).toBeNull();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'mission.disclosure.set',
      expanded: false,
    });
  });
});
