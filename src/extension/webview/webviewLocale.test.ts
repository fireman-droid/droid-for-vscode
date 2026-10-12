import { expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { bindWebviewLocale, readWebviewLocale } from './webviewLocale';

const host = vi.hoisted(() => ({ preference: 'auto', language: 'zh-Hant', listeners: new Set<(event: { affectsConfiguration(key: string): boolean }) => void>() }));
vi.mock('vscode', () => ({
  env: { get language() { return host.language; } },
  workspace: {
    getConfiguration: () => ({ get: () => host.preference }),
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration(key: string): boolean }) => void) => {
      host.listeners.add(listener); return { dispose: () => host.listeners.delete(listener) };
    },
  },
  Disposable: class { constructor(private readonly cleanup: () => void) {} dispose() { this.cleanup(); } },
}));

it('replays the effective language and updates every bound surface, including hidden panels', () => {
  expect(readWebviewLocale()).toEqual({ type: 'ui.locale', preference: 'auto', resolved: 'zh-TW' });
  const surfaces = Array.from({ length: 5 }, () => {
    let receive: ((message: unknown) => void) | undefined;
    const postMessage = vi.fn().mockResolvedValue(true);
    const webview = { postMessage, onDidReceiveMessage: (listener: (message: unknown) => void) => {
      receive = listener; return { dispose: () => { receive = undefined; } };
    } } as unknown as vscode.Webview;
    const binding = bindWebviewLocale(webview);
    return { binding, postMessage, read: () => receive?.({ type: 'ui.locale.read' }) };
  });
  surfaces.forEach(surface => surface.read());
  host.preference = 'en';
  host.listeners.forEach(listener => listener({ affectsConfiguration: key => key === 'droidvisx.language' }));
  for (const surface of surfaces) {
    expect(surface.postMessage).toHaveBeenNthCalledWith(1, { type: 'ui.locale', preference: 'auto', resolved: 'zh-TW' });
    expect(surface.postMessage).toHaveBeenNthCalledWith(2, { type: 'ui.locale', preference: 'en', resolved: 'en' });
    surface.binding.dispose(); surface.read();
    expect(surface.postMessage).toHaveBeenCalledTimes(2);
  }
  expect(host.listeners.size).toBe(0);
});
