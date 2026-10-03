import { afterEach, describe, expect, it, vi } from 'vitest';
const vscodeMock = vi.hoisted(() => {
  let receive: ((value: unknown) => void) | undefined;
  let disposePanel: (() => void) | undefined;
  const disposable = () => ({ dispose() {} });
  const postMessage = vi.fn(async (_message: unknown) => true);
  const panel = {
    visible: true,
    reveal: vi.fn(),
    dispose: () => disposePanel?.(),
    onDidDispose: (listener: () => void) => {
      disposePanel = listener;
      return disposable();
    },
    onDidChangeViewState: disposable,
    webview: {
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage,
      onDidReceiveMessage: (listener: (value: unknown) => void) => {
        receive = listener;
        return disposable();
      },
    },
  };
  return {
    Uri: {
      joinPath: (_root: unknown, ...parts: string[]) => ({
        toString: () => parts.join('/'),
      }),
    },
    ViewColumn: { Active: -1 },
    ColorThemeKind: { Light: 1, Dark: 2 },
    window: {
      createWebviewPanel: () => panel,
      activeColorTheme: { kind: 1 },
      onDidChangeActiveColorTheme: disposable,
      showWarningMessage: vi.fn(async () => undefined as string | undefined),
    },
    workspace: {
      getConfiguration: () => ({ get: () => 'auto' }),
      onDidChangeConfiguration: disposable,
    },
    receive: (value: unknown) => receive?.(value),
    panel,
    postMessage,
  };
});
vi.mock('vscode', () => vscodeMock);
import { ModelsPanelController } from './ModelsPanelController';
import type { ModelManager } from './ModelManager';
import { MODEL_MANAGER_VERSION } from '../../shared/protocol/modelManagerProtocol';

afterEach(() => vi.clearAllMocks());
function fixture() {
  const execute = vi.fn(async () => ({ message: 'Saved' }));
  const snapshot = vi.fn(async () => ({
    connections: [],
    models: [],
    activeModelId: null,
    canApply: false,
    applyMessage: 'No chat',
  }));
  const controller = new ModelsPanelController(
    {} as never,
    { execute, snapshot } as unknown as ModelManager,
  );
  controller.open();
  const send = (requestId: string, action: unknown) =>
    vscodeMock.receive({
      type: 'models.request',
      version: MODEL_MANAGER_VERSION,
      requestId,
      action,
    });
  return { controller, execute, send };
}
describe('Models panel operation lifetime', () => {
  it('releases ownership after native cancellation and refreshes before confirming the next request', async () => {
    const { controller, execute, send } = fixture();
    send('cancelled', { kind: 'verifyModel', rawIndex: 0, expectedModel: 'model', connectionId: 'gateway' });
    await vi.waitFor(() =>
      expect(vscodeMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'models.result',
          requestId: 'cancelled',
          ok: false,
        }),
      ),
    );
    expect(execute).not.toHaveBeenCalled();
    send('next', { kind: 'refresh' });
    await vi.waitFor(() =>
      expect(vscodeMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'models.result',
          requestId: 'next',
          ok: true,
        }),
      ),
    );
    const sent = vscodeMock.postMessage.mock.calls.map(
      ([message]) => message as { type: string },
    );
    expect(sent.at(-2)?.type).toBe('models.snapshot');
    expect(sent.at(-1)?.type).toBe('models.result');
    controller.dispose();
  });
  it('aborts an in-flight operation on disposal and does not post its late result', async () => {
    const { controller, execute, send } = fixture();
    let finish!: () => void;
    execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ message: 'Late' });
        }),
    );
    send('pending', { kind: 'refresh' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const signal = (execute.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
    controller.dispose();
    expect(signal.aborted).toBe(true);
    const count = vscodeMock.postMessage.mock.calls.length;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vscodeMock.postMessage).toHaveBeenCalledTimes(count);
  });
});
