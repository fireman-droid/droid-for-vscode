import * as vscode from 'vscode';
import {
  MODEL_SOURCE_VERSION,
  isModelSourceMode,
  parseModelSourceRequest,
  type ModelSourceMode,
  type ModelSourceState,
} from '../../shared/protocol/modelSourceProtocol';

// All model selectors in this extension host write the same user preference.
let pendingWrite = Promise.resolve();

function readMode(): ModelSourceMode {
  const value = vscode.workspace.getConfiguration('droidvisx').get<unknown>('modelSource');
  return isModelSourceMode(value) ? value : 'mixed';
}

export function createModelSourcePreference(webview: Pick<vscode.Webview, 'postMessage'>): {
  handleMessage(value: unknown): boolean;
  dispose(): void;
} {
  let disposed = false;
  const publish = (error?: string): void => {
    if (disposed) return;
    const message: ModelSourceState = {
      type: 'ui.modelSource.state',
      version: MODEL_SOURCE_VERSION,
      mode: readMode(),
      ...(error === undefined ? {} : { error }),
    };
    void webview.postMessage(message).then(() => undefined, () => undefined);
  };
  const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('droidvisx.modelSource')) publish();
  });

  return {
    handleMessage(value): boolean {
      if (disposed) return false;
      const request = parseModelSourceRequest(value);
      if (request === null) return false;
      if (request.type === 'ui.modelSource.read') {
        publish();
      } else {
        pendingWrite = pendingWrite.then(async () => {
          try {
            await vscode.workspace.getConfiguration('droidvisx').update(
              'modelSource', request.mode, vscode.ConfigurationTarget.Global,
            );
            publish();
          } catch {
            publish('无法保存模型来源设置，请重试。');
          }
        });
      }
      return true;
    },
    dispose(): void {
      disposed = true;
      subscription.dispose();
    },
  };
}
