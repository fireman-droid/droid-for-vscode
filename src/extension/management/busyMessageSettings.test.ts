import { expect, it, vi } from 'vitest';
import { parseManagementRequest } from '../../shared/protocol/managementPageProtocol';

const config = vi.hoisted(() => ({ value: 'wait', update: vi.fn() }));
vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({ get: () => config.value, update: config.update }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }) },
}));
import { ManagementBinding, type ManagementServices } from './ManagementBinding';
import { readBusyMessageMode } from '../chat/queue/busyMessageSettings';

it('persists the selected mode and returns it to the settings page', async () => {
  let receive!: (message: unknown) => void;
  const post = vi.fn();
  config.update.mockImplementation(async (_key: string, value: string) => { config.value = value; });
  const services = { settings: { read: async () => ({ busyMessageMode: readBusyMessageMode() }) } } as unknown as ManagementServices;
  const binding = new ManagementBinding({ postMessage: post, onDidReceiveMessage: callback => {
    receive = callback; return { dispose() {} };
  } }, services, 'general');
  for (const mode of ['steer', 'wait'] as const) {
    receive({ type: 'management.request', version: 1, requestId: mode, action: { kind: 'chat.busyMessageMode.set', mode } });
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: mode, ok: true, settings: { busyMessageMode: mode },
    })));
    expect(config.update).toHaveBeenLastCalledWith('chat.busyMessageMode', mode, 1);
  }
  binding.dispose();
});

it('rejects unknown delivery modes at the bridge boundary', () => {
  expect(parseManagementRequest({ type: 'management.request', version: 1, requestId: 'bad',
    action: { kind: 'chat.busyMessageMode.set', mode: 'interrupt' } })).toBeUndefined();
});
