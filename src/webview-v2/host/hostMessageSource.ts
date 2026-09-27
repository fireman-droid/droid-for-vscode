import { parseMissionControlPanelHostMessage } from '../../shared/protocol/missionControlPanelProtocol';
import { readHostMessage } from '../bridge/vscode';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { readStringDataProperty } from '../bridge/host/guards';

export type DecodedHostMessage =
  | NonNullable<ReturnType<typeof readHostMessage>>
  | NonNullable<ReturnType<typeof parseMissionControlPanelHostMessage>>;

type Listener = (message: DecodedHostMessage) => void;
type RejectedMessage = { readonly type: string; readonly sequence: number | null };
const listeners = new Set<{ readonly receive: Listener; readonly reject?: (message: RejectedMessage) => void }>();
const TRANSCRIPT_MESSAGE_TYPES = new Set([
  'host.snapshot', 'host.connection', 'turn.state', 'turn.error', 'assistant.delta',
  'thinking.delta', 'thinking.complete', 'tool.activity', 'interaction.request', 'interaction.closed',
]);

function receive(event: MessageEvent<unknown>): void {
  const message =
    parseMissionControlPanelHostMessage(event.data) ?? readHostMessage(event.data);
  if (message !== null && message !== undefined) {
    for (const listener of listeners) listener.receive(message);
  } else if (isStrictRecord(event.data)) {
    const type = readStringDataProperty(event.data, 'type');
    if (type === undefined || !TRANSCRIPT_MESSAGE_TYPES.has(type)) return;
    const descriptor = Reflect.getOwnPropertyDescriptor(event.data, 'sequence');
    const sequence: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    const rejected = { type, sequence: typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null };
    for (const listener of listeners) listener.reject?.(rejected);
  }
}

/** One decoded input per page; feature subscriptions keep their own identity policy. */
export function subscribeHostMessages(listener: Listener, onRejected?: (message: RejectedMessage) => void): () => void {
  if (listeners.size === 0) window.addEventListener('message', receive);
  const subscription = { receive: listener, ...(onRejected === undefined ? {} : { reject: onRejected }) };
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
    if (listeners.size === 0) window.removeEventListener('message', receive);
  };
}
