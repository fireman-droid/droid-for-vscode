import { type CurrentTurn } from '../internals';
import { type TurnWatchdogState } from './turnWatchdog';
export class TurnState {
  turn: CurrentTurn | null = null;
  turnGeneration = 0;
  stopRequestGeneration: number | null = null;
  specHandoff:
    | { readonly turnId: string; readonly status: 'expected' }
    | {
        readonly turnId: string;
        readonly status: 'detected';
        readonly implementationSessionId: string;
      }
    | null = null;
  turnWatchdog: TurnWatchdogState | null = null;
  turnIo: {
    counts: Map<string, number>;
    bytes: number;
  } | null = null;
  readonly interactionOpenedAt = new Map<string, number>();
}
