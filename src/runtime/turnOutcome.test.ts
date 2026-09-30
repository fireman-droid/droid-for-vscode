import { describe, expect, it } from 'vitest';
import { projectDurableTurnOutcome, type DaemonTurnOutcome } from './turnOutcome';

describe('durable daemon turn outcomes', () => {
  it.each([
    ['completed', 'success'], ['spec_handoff', 'success'], ['cancelled', 'interrupted'],
    ['permission_rejected', 'interrupted'], ['error', 'error_during_execution'],
    ['model_provider_unreachable', 'error_during_execution'],
    ['structured_output_invalid', 'error_structured_output'],
  ] as const)('retains the SDK outcome for %s without inventing usage', (reason, outcome) => {
    const result = projectDurableTurnOutcome('session', 'backend', {
      type: 'agent_turn_outcome', turnId: 'backend', reason: reason as DaemonTurnOutcome['reason'], resultKind: 'text',
    });
    expect(result?.completion).toMatchObject({ type: 'turn-complete', outcome });
    expect(result?.completion.turnUsage).toBeUndefined();
  });

  it('retains structured results for the exact requested turn', () => {
    const result = projectDurableTurnOutcome('session', 'backend', {
      type: 'agent_turn_outcome', turnId: 'backend', reason: 'completed' as DaemonTurnOutcome['reason'], resultKind: 'structured',
      result: { done: true }, schemaFingerprint: 'schema',
    });
    expect(result).toMatchObject({ backendTurnId: 'backend', resultKind: 'structured', structuredResult: { done: true } });
  });

  it('keeps absent outcomes unconfirmed and rejects another turn’s result', () => {
    expect(projectDurableTurnOutcome('session', 'backend', null)).toBeNull();
    expect(() => projectDurableTurnOutcome('session', 'backend', {
      type: 'agent_turn_outcome', turnId: 'other', reason: 'completed' as DaemonTurnOutcome['reason'], resultKind: 'text',
    })).toThrow('different turn');
  });
});
