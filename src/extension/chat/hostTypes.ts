import type { DroidRuntime } from '../../runtime/DroidRuntime';
import type { RuntimeInteractionHandler } from '../../runtime/events/runtimeInteractions';
import { type HostToWebviewMessage } from '../../shared/bridgeMessages';
export type DroidRuntimeFactory = (
  interactionHandler: RuntimeInteractionHandler,
) => DroidRuntime;

export interface WorkspaceContext {
  readonly cwd: string | null;
  readonly trusted: boolean;
}

export type WorkspaceContextProvider = () => WorkspaceContext;

/** Everything the controller emits; the view provider's sequence-free
    `ui.theme` push never passes the sequence stamper below. */
export type ControllerHostMessage = Exclude<HostToWebviewMessage, { type: 'ui.theme' }>;

export type ChatControllerListener = (message: ControllerHostMessage) => void;

export type UnsequencedHostMessage = ControllerHostMessage extends infer Message
  ? Message extends ControllerHostMessage
    ? Omit<Message, 'sequence'>
    : never
  : never;
