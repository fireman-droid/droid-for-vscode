// @vitest-environment jsdom

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  type MissionControlCatalogRow,
} from '../../shared/missionControlPanelProtocol';

const staleRow = row('mission-safe-stale', 'Stale Mission');
const currentRow = row('mission-safe-current', 'Current Mission');

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  delete window.__dvxBooted;
});

describe('Mission Control Webview route ownership', () => {
  it('keeps stale rows and binds Back to the replacement catalog request', async () => {
    const posted: unknown[] = [];
    window.__dvxApi = {
      postMessage: (message) => {
        posted.push(message);
      },
    };
    await act(async () => {
      await import('./main');
    });
    const user = userEvent.setup();

    expect(posted).toContainEqual({
      type: 'missionControl.ready',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    });
    await user.click(screen.getByRole('button', { name: 'New Mission' }));
    await user.click(screen.getByRole('button', { name: 'Back to Missions' }));
    const initialBack = lastNavigation(posted, 'catalog');
    expect(screen.getByRole('status').textContent).toBe('Loading Missions…');

    publishCatalog(initialBack.requestId, [staleRow]);
    expect(
      screen.getByRole('button', {
        name: 'Open Mission “Stale Mission” in Workspace',
      }),
    ).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const canceledRefresh = lastCatalogRequest(posted);
    await user.click(
      screen.getByRole('button', {
        name: 'Open Mission “Stale Mission” in Workspace',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Back to Missions' }));
    const refreshBack = lastNavigation(posted, 'catalog');

    expect(screen.getByRole('status').textContent).toBe(
      'Refreshing Missions…',
    );
    expect(screen.getByText('Stale Mission')).toBeDefined();

    publishCatalog(canceledRefresh.requestId, [
      row('mission-safe-canceled', 'Canceled Mission'),
    ]);
    expect(screen.queryByText('Canceled Mission')).toBeNull();
    expect(screen.getByText('Stale Mission')).toBeDefined();

    publishCatalog(refreshBack.requestId, [currentRow]);
    expect(screen.getByText('Current Mission')).toBeDefined();
    expect(screen.queryByText('Stale Mission')).toBeNull();
  });
});

function publishCatalog(
  requestId: string,
  rows: readonly MissionControlCatalogRow[],
): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'missionControl.catalog.result',
          protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          sequence: 1,
          requestId,
          status: 'ready',
          revision: 1,
          filter: 'all',
          rows,
        },
      }),
    );
  });
}

function lastNavigation(
  posted: readonly unknown[],
  route: 'catalog',
): { readonly requestId: string } {
  const message = posted.findLast(
    (value) =>
      isRecord(value) &&
      value.type === 'missionControl.navigate' &&
      value.route === route,
  );
  expect(message).toBeDefined();
  return message as { readonly requestId: string };
}

function lastCatalogRequest(
  posted: readonly unknown[],
): { readonly requestId: string } {
  const message = posted.findLast(
    (value) =>
      isRecord(value) && value.type === 'missionControl.catalog.request',
  );
  expect(message).toBeDefined();
  return message as { readonly requestId: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function row(
  catalogId: string,
  title: string,
): MissionControlCatalogRow {
  return {
    catalogId,
    title,
    lifecycle: 'running',
    workspaceLabel: 'Workspace',
    computerLabel: '—',
    progress: null,
    createdAt: null,
    updatedAt: null,
    elapsedMs: null,
    attached: false,
  };
}
