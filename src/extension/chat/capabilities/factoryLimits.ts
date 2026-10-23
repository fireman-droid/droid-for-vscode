import type { HostToWebviewMessage } from '../../../shared/bridgeMessages';
import type {
  FactoryAccountState,
  FactoryLimitPool,
  FactoryLimitWindow,
  FactoryLimits,
} from '../../../shared/protocol/factoryAccountProtocol';
import {
  LIMITS_REQUEST_FAILED_MESSAGE,
  type FactoryAccountResult,
  type RawLimitPool,
} from '../../../runtime/account/factoryAccount';
import type { FactoryAccountService } from '../../account/FactoryAccountService';

type Emit = (
  message: Omit<
    Extract<HostToWebviewMessage, { type: 'factory.limits' }>,
    'sequence'
  >,
) => void;

export interface FactoryLimitsHostPort {
  readonly accountService?: FactoryAccountService;
  emit: Emit;
  recordPanelFailure(code: string, detail: string): void;
}

const LOADING: FactoryAccountState = { status: 'loading' };

/** Projects one billing window; unstarted windows stay empty. */
function projectWindow(window: FactoryLimitWindow): FactoryLimitWindow {
  return {
    usedPercent: Math.round(window.usedPercent * 10) / 10,
    windowEnd: window.windowEnd,
    secondsRemaining: window.secondsRemaining,
  };
}

function projectPool(pool: RawLimitPool): FactoryLimitPool {
  return {
    fiveHour: projectWindow(pool.fiveHour),
    weekly: projectWindow(pool.weekly),
    monthly: projectWindow(pool.monthly),
  };
}

export function projectFactoryLimits(
  result: Extract<FactoryAccountResult, { status: 'ok' }>,
): FactoryLimits {
  return {
    standard: projectPool(result.limits.standard),
    core: projectPool(result.limits.core),
    extraUsageBalanceCents: result.limits.extraUsageBalanceCents,
    extraUsageAllowed: result.limits.extraUsageAllowed,
    canManageOverage: result.limits.canManageOverage,
  };
}

/**
 * Emits the loading marker, then the resolved projection. A signed-out
 * CLI becomes an explicit unavailable state rather than an empty panel,
 * so both surfaces can say what to do next.
 */
export async function refreshFactoryLimits(
  ctl: FactoryLimitsHostPort,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  if (ctl.accountService === undefined) {
    ctl.emit({
      type: 'factory.limits',
      account: { status: 'unavailable', message: LIMITS_REQUEST_FAILED_MESSAGE },
    });
    return;
  }
  ctl.emit({ type: 'factory.limits', account: LOADING });
  let result: FactoryAccountResult;
  try {
    result = await ctl.accountService.read(options);
  } catch {
    ctl.recordPanelFailure('factory-limits-failed', LIMITS_REQUEST_FAILED_MESSAGE);
    ctl.emit({
      type: 'factory.limits',
      account: { status: 'unavailable', message: LIMITS_REQUEST_FAILED_MESSAGE },
    });
    return;
  }
  if (result.status === 'unavailable') {
    ctl.emit({
      type: 'factory.limits',
      account: { status: 'unavailable', message: result.message },
    });
    return;
  }
  const now = new Date();
  if (result.status === 'identity-only') {
    ctl.recordPanelFailure('factory-limits-unavailable', result.limitsError);
    ctl.emit({
      type: 'factory.limits',
      account: {
        status: 'ready',
        identity: result.identity,
        limits: null,
        limitsError: result.limitsError,
        fetchedAt: now.toISOString(),
      },
    });
    return;
  }
  ctl.emit({
    type: 'factory.limits',
    account: {
      status: 'ready',
      identity: result.identity,
      limits: projectFactoryLimits(result),
      limitsError: null,
      fetchedAt: now.toISOString(),
    },
  });
}
