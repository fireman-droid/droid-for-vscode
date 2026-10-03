import { getVsCodeApi } from '../bridge/vscode';
import { mountWebview } from '../shell/mount';
import { ChatApp } from './ChatApp';

const port = getVsCodeApi();
const role = document.documentElement.dataset.chatRole === 'child' ? 'child' : 'main';
mountWebview(<ChatApp port={port} role={role} />, (detail) =>
  port.postMessage({ type: 'webview.diagnostic', kind: 'error', detail }),
);
