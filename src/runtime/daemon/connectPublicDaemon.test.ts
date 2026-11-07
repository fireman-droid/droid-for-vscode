import { describe, expect, it, vi } from 'vitest';
import { createWebSocketDaemonClient, DaemonSessionController, type IDaemonClient } from '@factory/droid-sdk';
import { connectPublicDaemon } from './connectPublicDaemon';

vi.mock('@factory/droid-sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@factory/droid-sdk')>();
  return { ...actual, createWebSocketDaemonClient: vi.fn(), DaemonSessionController: vi.fn() };
});

describe('public daemon history loading policy', () => {
  it('limits loads before controller ownership without replacing client lifecycle or losing this', async () => {
    const disconnected = new Error('synthetic connection failure');
    class Client {
      private readonly marker = 'original-client';
      readonly requests: Parameters<IDaemonClient['loadSession']>[0][] = [];
      readonly close = vi.fn();
      async loadSession(params: Parameters<IDaemonClient['loadSession']>[0]) {
        expect(this.marker).toBe('original-client');
        this.requests.push(params);
        throw disconnected;
      }
    }
    const client = new Client();
    const originalClose = client.close;
    vi.mocked(createWebSocketDaemonClient).mockReturnValue(
      client as unknown as ReturnType<typeof createWebSocketDaemonClient>,
    );
    let injected: IDaemonClient | undefined;
    vi.mocked(DaemonSessionController).mockImplementation(function (options) {
      injected = options.daemonClient;
      expect(options.config.defaultMessageLimit).toBe(100);
      return {
        async attemptInitialConnection() {
          // Exercise requests at the controller/client boundary, including the
          // full-history flag emitted by SDK-internal loads.
          for (const loadAllMessages of [true, false, undefined]) {
            await expect(injected!.loadSession({
              sessionId: 'session', token: 'test-only', messageLimit: 171, loadAllMessages,
              disableBuiltinSkills: true,
            })).rejects.toBe(disconnected);
          }
          throw disconnected;
        },
        destroy() { client.close(); },
      } as unknown as DaemonSessionController;
    });
    await expect(connectPublicDaemon({
      url: 'ws://127.0.0.1:1', auth: { apiKey: 'test-only' },
    })).rejects.toBe(disconnected);
    expect(injected).toBe(client);
    expect(client.requests).toEqual(Array.from({ length: 3 }, () => ({
      sessionId: 'session', token: 'test-only', messageLimit: 171, loadAllMessages: false, disableBuiltinSkills: true,
    })));
    expect(client.close).toBe(originalClose);
    expect(client.close).toHaveBeenCalledOnce();
  });
});
