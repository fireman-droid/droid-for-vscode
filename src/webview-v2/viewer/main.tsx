import { mountWebview } from '../shell/mount';
import { reportWebviewRenderError, watchWebviewHandshake } from '../shell/diagnostics';
import { parseSessionViewerHostMessage } from './validateSessionViewerHostMessage';
import { SessionViewerApp } from './SessionViewerApp';

const vscode = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!vscode) throw new Error('Session Viewer failed to initialize.');
watchWebviewHandshake(value => parseSessionViewerHostMessage(value) !== null);
mountWebview(<SessionViewerApp vscode={vscode} />, reportWebviewRenderError);
