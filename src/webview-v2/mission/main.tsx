import { mountWebview } from '../shell/mount';
import { MissionControlApp } from './MissionControlApp';

const vscode = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!vscode) throw new Error('Mission Control failed to initialize.');
mountWebview(<MissionControlApp vscode={vscode} />, (detail) => console.error(detail));
