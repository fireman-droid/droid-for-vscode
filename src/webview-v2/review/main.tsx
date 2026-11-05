import { mountWebview } from '../shell/mount';
import { reportWebviewRenderError, watchWebviewHandshake } from '../shell/diagnostics';
import { isReviewPanelContext } from '../../shared/protocol/reviewPanelProtocol';
import { parseReviewHostMessage } from '../../shared/protocol/reviewProtocol';
import { ReviewApp } from './ReviewApp';
const port = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!port) throw new Error('Review failed to initialize.');
watchWebviewHandshake(value => isReviewPanelContext(value) || parseReviewHostMessage(value) !== undefined);
mountWebview(<ReviewApp port={port} />, reportWebviewRenderError);
