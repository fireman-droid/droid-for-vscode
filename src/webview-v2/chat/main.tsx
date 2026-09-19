import { getVsCodeApi } from '../../webview/bridge/vscode';
import { mountWebview } from '../shell/mount';
import { ChatApp } from './ChatApp';

const port = getVsCodeApi();
mountWebview(<ChatApp port={port} />, (detail) =>
  port.postMessage({ type: 'webview.diagnostic', kind: 'error', detail }),
);
