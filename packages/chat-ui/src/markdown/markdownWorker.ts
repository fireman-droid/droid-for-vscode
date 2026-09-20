import { parseMarkdown } from './parseMarkdown';
import { createMarkdownTreeDelta, type MarkdownParseRequest, type MarkdownParseResponse } from './markdownWorkerProtocol';

let delta = createMarkdownTreeDelta();
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MarkdownParseRequest>) => void) | null;
  postMessage(message: MarkdownParseResponse): void;
};
worker.onmessage = ({ data }) => {
  try {
    if (data.reset) delta = createMarkdownTreeDelta();
    worker.postMessage({ id: data.id, nodes: delta(parseMarkdown(data.text, data.thinking)) });
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
