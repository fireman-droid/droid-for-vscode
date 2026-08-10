import type { RuntimeAvailability, RuntimeEvent } from './runtimeEvents';

export type RuntimeSessionTarget =
  | {
      readonly kind: 'new';
      readonly cwd: string;
    }
  | {
      readonly kind: 'resume';
      readonly cwd: string;
      readonly sessionId: string;
    };

export interface DroidRuntime {
  initialize(
    target: RuntimeSessionTarget | string,
  ): Promise<RuntimeAvailability>;
  sendTurn(text: string): AsyncIterable<RuntimeEvent>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
}
