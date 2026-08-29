import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import {
  BRIDGE_PROTOCOL_VERSION,
  type WebviewToHostMessage,
} from '../shared/bridgeMessages';
import { isStrictRecord } from '../shared/strictValidation';
import { parseWebviewMessage } from '../shared/validateMessage';
import type { ChatController } from './ChatController';

const BEACON_ERROR_KINDS: ReadonlySet<string> = new Set([
  'boot-timeout',
  'handshake-timeout',
  'error',
  'unhandledrejection',
]);

interface MissionWorkspaceRoute {
  readonly handleMessage: (value: unknown) => boolean;
  readonly replay: () => void;
}

export interface WebviewMessageRouteOptions {
  readonly controller: ChatController;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly missionWorkspace?: MissionWorkspaceRoute;
  readonly openMissionControl?: (
    target: 'catalog' | 'setup',
    task?: string,
  ) => void;
  readonly postTheme: () => void;
  readonly onReady?: (
    message: Extract<WebviewToHostMessage, { type: 'webview.ready' }>,
  ) => void;
}

export function routeWebviewMessage(
  untrustedMessage: unknown,
  options: WebviewMessageRouteOptions,
): void {
  if (options.missionWorkspace?.handleMessage(untrustedMessage) === true) {
    return;
  }
  const message = parseWebviewMessage(untrustedMessage);
  if (message === undefined) {
    const mismatch = readReadyProtocolMismatch(untrustedMessage);
    if (mismatch !== null) {
      options.diagnostics?.record({
        level: 'error',
        name: 'host.bridge.protocol-mismatch',
        attributes: {
          expected: BRIDGE_PROTOCOL_VERSION,
          received: mismatch,
        },
      });
      return;
    }
    options.diagnostics?.record({
      level: 'warn',
      name: 'host.bridge.rejected',
      attributes: { direction: 'inbound' },
      detail: safeStringify(untrustedMessage),
    });
    return;
  }

  if (message.type === 'webview.diagnostic') {
    options.diagnostics?.record({
      level: BEACON_ERROR_KINDS.has(message.kind) ? 'error' : 'info',
      name: `webview.${message.kind}`,
      detail: message.detail,
    });
    return;
  }
  if (message.type === 'ui.theme.set') {
    void vscode.workspace
      .getConfiguration('droidvisx')
      .update(
        'theme',
        message.preference,
        vscode.ConfigurationTarget.Global,
      )
      .then(
        () => undefined,
        () => {
          options.diagnostics?.record({
            level: 'warn',
            name: 'host.theme.persist-failed',
            attributes: { preference: message.preference },
          });
        },
      );
    return;
  }
  if (message.type === 'mission.panel.open') {
    options.openMissionControl?.(
      message.target ?? 'catalog',
      message.task,
    );
    return;
  }
  if (message.type === 'webview.ready') {
    options.postTheme();
    options.missionWorkspace?.replay();
    if (options.onReady === undefined) {
      options.controller.handleMessage(message);
    } else {
      options.onReady(message);
    }
    return;
  }
  options.controller.handleMessage(message);
}

function readReadyProtocolMismatch(
  value: unknown,
): string | number | null {
  if (
    !isStrictRecord(value) ||
    value.type !== 'webview.ready' ||
    value.protocolVersion === BRIDGE_PROTOCOL_VERSION
  ) {
    return null;
  }
  return typeof value.protocolVersion === 'number'
    ? value.protocolVersion
    : safeStringify(value.protocolVersion).slice(0, 64);
}

function safeStringify(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 2048);
  } catch {
    return String(value).slice(0, 2048);
  }
}
