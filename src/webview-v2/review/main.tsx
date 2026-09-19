import { mountWebview } from '../shell/mount';
import { ReviewApp } from './ReviewApp';
const port = (window as Window & { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
if (!port) throw new Error('Review failed to initialize.');
mountWebview(<ReviewApp port={port} />, (detail) => console.error(detail));
