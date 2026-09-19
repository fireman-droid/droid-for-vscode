import { mountWebview } from '../shell/mount';
import { SessionViewerApp } from './SessionViewerApp';

const vscode = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!vscode) throw new Error('Session Viewer failed to initialize.');
mountWebview(<SessionViewerApp vscode={vscode} />, (detail) => console.error(detail));
