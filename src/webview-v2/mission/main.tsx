import { mountWebview } from '../shell/mount';
import { reportWebviewRenderError, watchWebviewHandshake } from '../shell/diagnostics';
import { parseMissionControlPanelHostMessage } from '../../shared/protocol/missionControlPanelProtocol';
import { MissionControlApp } from './MissionControlApp';

const vscode = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!vscode) throw new Error('Mission Control failed to initialize.');
watchWebviewHandshake(value => parseMissionControlPanelHostMessage(value) !== undefined);
mountWebview(<MissionControlApp vscode={vscode} />, reportWebviewRenderError);
