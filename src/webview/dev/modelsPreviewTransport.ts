import type {
  ModelsHostMessage,
  ModelsSnapshot,
} from '../../shared/protocol/modelManagerProtocol';
import { MODEL_MANAGER_VERSION } from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from '../models/useModels';

export function createModelsPreviewTransport() {
  const listeners = new Set<(value: unknown) => void>();
  let failNextSave = false;
  let snapshot: ModelsSnapshot = {
    connections: [
      {
        id: 'gateway',
        name: 'Personal gateway',
        protocol: 'generic-chat-completion-api',
        baseUrl: 'https://gateway.example.com/v1',
        hasKey: true,
        imported: false,
      },
      {
        id: 'imported',
        name: 'Research endpoint',
        protocol: 'anthropic',
        baseUrl: 'https://research.example.com/anthropic',
        hasKey: true,
        imported: true,
      },
    ],
    models: [
      {
        rawIndex: 0,
        model: 'gateway-reasoner',
        displayName: 'Reasoner · Personal gateway',
        connectionId: 'gateway',
        maxOutputTokens: 8192,
        noImageSupport: false,
        valid: true,
        runtimeId: 'preview:reasoner',
        loadMessage: 'Loaded by Droid',
        test: null,
      },
      {
        rawIndex: 1,
        model: 'gateway-fast',
        displayName: 'Fast · Personal gateway',
        connectionId: 'gateway',
        maxOutputTokens: null,
        noImageSupport: true,
        valid: true,
        runtimeId: null,
        loadMessage: 'Saved, but not present in the Droid catalog.',
        test: null,
      },
    ],
    activeModelId: null,
    canApply: true,
    applyMessage: 'Preview chat is idle. No real provider requests are made.',
  };
  const emit = (message: ModelsHostMessage): void => {
    for (const listener of listeners) listener(message);
  };
  const publish = (): void =>
    emit({ type: 'models.snapshot', version: MODEL_MANAGER_VERSION, snapshot });
  const transport: ModelsTransport = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    postMessage(request) {
      if (request.action.kind === 'cancel') return;
      setTimeout(() => {
        const action = request.action;
        let result: Extract<ModelsHostMessage, { type: 'models.result' }> = {
          type: 'models.result',
          version: MODEL_MANAGER_VERSION,
          requestId: request.requestId,
          ok: true,
          message: 'Preview operation completed. No real provider request.',
        };
        if (
          failNextSave &&
          (action.kind === 'saveConnection' ||
            action.kind === 'saveModel' ||
            action.kind === 'importModels')
        ) {
          failNextSave = false;
          result = {
            ...result,
            ok: false,
            message: 'Simulated save failure. Your draft has not been saved.',
          };
        } else if (action.kind === 'saveConnection') {
          const draft = action.draft;
          const id = draft.id ?? `connection-${snapshot.connections.length}`;
          const previous = snapshot.connections.find((item) => item.id === id);
          snapshot = {
            ...snapshot,
            connections: [
              ...snapshot.connections.filter((item) => item.id !== id),
              {
                id,
                name: draft.name,
                protocol: draft.protocol,
                baseUrl: draft.baseUrl,
                hasKey: draft.setApiKey || previous?.hasKey === true,
                imported: false,
              },
            ],
          };
          result = {
            ...result,
            connectionId: id,
            message: 'Connection saved in preview.',
          };
        } else if (action.kind === 'saveModel') {
          const draft = action.draft;
          const rawIndex =
            draft.rawIndex ??
            Math.max(-1, ...snapshot.models.map((item) => item.rawIndex)) + 1;
          snapshot = {
            ...snapshot,
            models: [
              ...snapshot.models.filter((item) => item.rawIndex !== rawIndex),
              {
                rawIndex,
                model: draft.model,
                displayName:
                  draft.displayName ||
                  `${draft.model} · ${snapshot.connections.find((item) => item.id === draft.connectionId)?.name}`,
                connectionId: draft.connectionId,
                maxOutputTokens: draft.maxOutputTokens,
                noImageSupport: draft.noImageSupport,
                valid: true,
                runtimeId: `preview:${rawIndex}`,
                loadMessage: 'Loaded by Droid',
                test: null,
              },
            ],
          };
        } else if (action.kind === 'discover') {
          result = {
            ...result,
            discovered: [
              { model: 'gateway-reasoner' },
              { model: 'gateway-fast' },
              { model: 'gateway-coder-32b' },
              { model: 'gateway-vision-large-context' },
            ],
            message: '4 models returned by the simulated provider.',
          };
        } else if (action.kind === 'importModels') {
          let rows = [...snapshot.models];
          for (const item of action.models) {
            if (
              rows.some(
                (row) =>
                  row.connectionId === action.connectionId && row.model === item.model,
              )
            )
              continue;
            const rawIndex = Math.max(-1, ...rows.map((row) => row.rawIndex)) + 1;
            rows.push({
              rawIndex,
              model: item.model,
              displayName: item.displayName ?? item.model,
              connectionId: action.connectionId,
              maxOutputTokens: null,
              noImageSupport: false,
              valid: true,
              runtimeId: `preview:${rawIndex}`,
              loadMessage: 'Loaded by Droid',
              test: null,
            });
          }
          snapshot = { ...snapshot, models: rows };
        } else if (action.kind === 'deleteModel') {
          snapshot = {
            ...snapshot,
            models: snapshot.models.filter((item) => item.rawIndex !== action.rawIndex),
          };
        } else if (action.kind === 'deleteConnection') {
          snapshot = {
            ...snapshot,
            connections: snapshot.connections.filter(
              (item) => item.id !== action.connectionId,
            ),
          };
        } else if (action.kind === 'verifyModel') {
          snapshot = {
            ...snapshot,
            models: snapshot.models.map((item) =>
              item.rawIndex === action.rawIndex
                ? {
                    ...item,
                    test: {
                      status: 'passed',
                      message: `Simulated reply from ${action.expectedModel}. No real call.`,
                      latencyMs: 320,
                    },
                  }
                : item,
            ),
          };
        } else if (action.kind === 'useModel') {
          if (snapshot.canApply)
            snapshot = {
              ...snapshot,
              activeModelId:
                snapshot.models.find((item) => item.rawIndex === action.rawIndex)
                  ?.runtimeId ?? null,
            };
          else result = { ...result, ok: false, message: snapshot.applyMessage };
        }
        publish();
        emit(result);
      }, 350);
    },
  };
  return {
    transport,
    failSave: () => {
      failNextSave = true;
    },
    busy: (busy: boolean) => {
      snapshot = {
        ...snapshot,
        canApply: !busy,
        applyMessage: busy
          ? 'Finish the current task or queued messages before changing the chat model.'
          : 'Preview chat is idle. No real provider requests are made.',
      };
      publish();
    },
    theme: (resolved: 'light' | 'dark') =>
      emit({ type: 'models.theme', version: MODEL_MANAGER_VERSION, resolved }),
  };
}

