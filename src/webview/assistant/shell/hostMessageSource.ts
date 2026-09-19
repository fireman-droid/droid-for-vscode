import { parseMissionControlPanelHostMessage } from '../../../shared/protocol/missionControlPanelProtocol';
import { readHostMessage } from '../../bridge/vscode';

export type DecodedHostMessage =
  | NonNullable<ReturnType<typeof readHostMessage>>
  | NonNullable<ReturnType<typeof parseMissionControlPanelHostMessage>>;

type Listener = (message: DecodedHostMessage) => void;
const listeners = new Set<Listener>();

function receive(event: MessageEvent<unknown>): void {
  const message =
    parseMissionControlPanelHostMessage(event.data) ?? readHostMessage(event.data);
  if (message !== null && message !== undefined) {
    for (const listener of listeners) listener(message);
  }
}

/** One decoded input per page; feature subscriptions keep their own identity policy. */
export function subscribeHostMessages(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener('message', receive);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('message', receive);
  };
}
