import { REPLAYABLE_CHAT_STATE } from '../../shared/protocol/stateDelivery';
import { getWebviewPageId } from '../bridge/vscode';
import type { StoreHostMessage } from '../state/types';
import type { ChatPort } from './chatIntent';

/** Called after synchronous store application, including streamed batches. */
export function acknowledgeAppliedState(port: ChatPort, messages: readonly StoreHostMessage[], before: number, after: number): void {
  let cursor = before;
  const applied: StoreHostMessage[] = [];
  for (const message of messages) {
    // Late messages rejected by the monotonic reducer must not hide a delivery gap.
    if (message.sequence <= cursor || message.sequence > after) continue;
    cursor = message.sequence;
    if (REPLAYABLE_CHAT_STATE.has(message.type)) applied.push(message);
  }
  for (let index = 0; index < applied.length; index += 256) {
    const chunk = applied.slice(index, index + 256);
    port.postMessage({ type: 'webview.state-applied', pageId: getWebviewPageId(port),
      sequences: chunk.map((message) => message.sequence),
      snapshotSequence: chunk.filter((message) => message.type === 'host.snapshot').at(-1)?.sequence ?? null });
  }
}
