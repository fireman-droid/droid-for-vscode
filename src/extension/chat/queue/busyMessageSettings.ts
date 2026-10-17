import * as vscode from 'vscode';
import type { BusyMessageMode } from '../../../shared/protocol/queueProtocol';

export const BUSY_MESSAGE_MODE_SETTING = 'chat.busyMessageMode';
export function readBusyMessageMode(): BusyMessageMode {
  return vscode.workspace.getConfiguration('droidvisx').get(BUSY_MESSAGE_MODE_SETTING) === 'steer' ? 'steer' : 'wait';
}
