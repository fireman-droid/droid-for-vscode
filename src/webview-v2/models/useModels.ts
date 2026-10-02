import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';
import {
  MODEL_MANAGER_VERSION,
  parseModelsHostMessage,
  parseModelsRequest,
  type ModelsAction,
  type ModelsRequest,
  type ModelsSnapshot,
  type ModelsHostMessage,
} from '../../shared/protocol/modelManagerProtocol';

export interface ModelsTransport {
  postMessage(message: ModelsRequest): void;
  postModelSourceMessage?(message: ModelSourceRequest): void;
  subscribe(listener: (message: unknown) => void): () => void;
}
export type ModelsResult = Extract<ModelsHostMessage, { type: 'models.result' }>;
export function useModels(transport: ModelsTransport) {
  const [snapshot, setSnapshot] = useState<ModelsSnapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  const [pending, setPending] = useState<ModelsAction['kind'] | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.dvxTheme === 'dark' ? 'dark' : 'light',
  );
  const operation = useRef<{
    id: string;
    resolve: (result: ModelsResult) => void;
  } | null>(null);
  const counter = useRef(0);
  const run = useCallback(
    (action: ModelsAction): Promise<ModelsResult> => {
      if (operation.current !== null)
        return Promise.resolve({
          type: 'models.result',
          version: MODEL_MANAGER_VERSION,
          requestId: '',
          ok: false,
          message: 'Wait for the current operation.',
        });
      const requestId = `models-${Date.now()}-${++counter.current}`;
      const request = parseModelsRequest({
        type: 'models.request',
        version: MODEL_MANAGER_VERSION,
        requestId,
        action,
      });
      if (request === undefined) {
        const result: ModelsResult = {
          type: 'models.result',
          version: MODEL_MANAGER_VERSION,
          requestId,
          ok: false,
          message:
            'Check the form values. Use a valid HTTP(S) Base URL without credentials, query or fragment, and a non-empty Model ID.',
        };
        setNotice(result);
        return Promise.resolve(result);
      }
      setPending(action.kind);
      setNotice(null);
      return new Promise((resolve) => {
        operation.current = { id: requestId, resolve };
        transport.postMessage(request);
      });
    },
    [transport],
  );
  useEffect(() => {
    const unsubscribe = transport.subscribe((value) => {
      const message = parseModelsHostMessage(value);
      if (message === undefined) return;
      if (message.type === 'models.theme') {
        setTheme(message.resolved);
        document.documentElement.dataset.dvxTheme = message.resolved;
      } else if (message.type === 'models.snapshot') {
        snapshotRef.current = message.snapshot;
        setSnapshot(message.snapshot);
      } else if (message.requestId === operation.current?.id) {
        const current = operation.current;
        operation.current = null;
        setPending(null);
        setNotice({ ok: message.ok, message: message.message });
        current.resolve(message);
      }
    });
    void run({ kind: 'refresh' });
    return () => {
      unsubscribe();
      operation.current?.resolve({
        type: 'models.result',
        version: MODEL_MANAGER_VERSION,
        requestId: operation.current.id,
        ok: false,
        message: 'Models page closed.',
      });
      operation.current = null;
    };
  }, [run, transport]);
  const cancel = (): void =>
    transport.postMessage({
      type: 'models.request',
      version: MODEL_MANAGER_VERSION,
      requestId: `cancel-${++counter.current}`,
      action: { kind: 'cancel' },
    });
  return {
    snapshot,
    pending,
    notice,
    theme,
    run,
    cancel,
    setNotice,
    readSnapshot: () => snapshotRef.current,
  };
}
