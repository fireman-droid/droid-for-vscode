// @vitest-environment jsdom

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  type MissionControlCatalogRow,
} from '../../shared/protocol/missionControlPanelProtocol';

const staleRow = row('mission-safe-stale', 'Stale Mission');
const currentRow = row('mission-safe-current', 'Current Mission');

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  delete window.__dvxBooted;
});

describe.each(['V2'] as const)('%s Mission Control Webview route ownership', () => {
  // Importing the real entry includes cold module transforms under parallel runs.
  it('keeps the catalog visible during workspace navigation and rejects stale refresh results', async () => {
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
    lastNavigation(posted, 'new-mission');
    expect(screen.queryByRole('button', { name: 'Back to Missions' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading Missions…');

    publishCatalog('host-initial-catalog', [staleRow]);
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
    lastNavigation(posted, 'detail');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const refreshBack = lastCatalogRequest(posted);

    expect(screen.getByRole('status').textContent).toBe('Refreshing Missions…');
    expect(screen.getByText('Stale Mission')).toBeDefined();

    publishCatalog(canceledRefresh.requestId, [
      row('mission-safe-canceled', 'Canceled Mission'),
    ]);
    expect(screen.queryByText('Canceled Mission')).toBeNull();
    expect(screen.getByText('Stale Mission')).toBeDefined();

    publishCatalog(refreshBack.requestId, [currentRow]);
    expect(screen.getByText('Current Mission')).toBeDefined();
    expect(screen.queryByText('Stale Mission')).toBeNull();
  }, 15_000);
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
  route: 'new-mission' | 'detail',
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

function lastCatalogRequest(posted: readonly unknown[]): { readonly requestId: string } {
  const message = posted.findLast(
    (value) => isRecord(value) && value.type === 'missionControl.catalog.request',
  );
  expect(message).toBeDefined();
  return message as { readonly requestId: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function row(catalogId: string, title: string): MissionControlCatalogRow {
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
