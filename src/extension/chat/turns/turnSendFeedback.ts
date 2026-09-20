import { TURN_SEND_REJECTED_CODE } from '../../../shared/protocol/turns';
import type { TurnStartEligibility } from '../operationEligibility';
import type { TurnFlowPort } from './turnFlowPort';

/** A rejected optimistic send needs its own response, without settling the Host's active turn. */
export function reportSendRejection(
  ctl: Pick<TurnFlowPort, 'emit' | 'turnState'>,
  sessionId: string,
  turnId: string,
  reason: Extract<TurnStartEligibility, { kind: 'blocked' }>['reason'],
): void {
  if (reason === 'duplicate-turn-id' && ctl.turnState.turn !== null) {
    ctl.emit({ type: 'turn.state', sessionId, turnId, status: ctl.turnState.turn.status });
    return;
  }
  ctl.emit({
    type: 'turn.error', sessionId, turnId, code: TURN_SEND_REJECTED_CODE,
    message: reason === 'settings-update-in-progress'
      ? 'Message was not sent while session settings were updating. Send it again when the update finishes.'
      : 'Message was not sent because the session was not ready. Reconnect or wait for the current operation, then send it again.',
    retryable: true,
  });
}
