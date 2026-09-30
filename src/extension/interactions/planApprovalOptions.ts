import { ToolConfirmationOutcome } from '@factory/droid-sdk/node';
import type { RuntimeAutonomyLevel } from '../../runtime/DroidRuntime';
import type { RuntimePermissionRequest } from '../../runtime/events/runtimeInteractions';

const sameSessionApproval = {
  off: ToolConfirmationOutcome.ProceedOnce,
  low: ToolConfirmationOutcome.ProceedAutoRunLow,
  medium: ToolConfirmationOutcome.ProceedAutoRunMedium,
  high: ToolConfirmationOutcome.ProceedAutoRunHigh,
} satisfies Record<RuntimeAutonomyLevel, ToolConfirmationOutcome>;

const newSessionApproval = {
  off: ToolConfirmationOutcome.ProceedNewSession,
  low: ToolConfirmationOutcome.ProceedNewSessionLow,
  medium: ToolConfirmationOutcome.ProceedNewSessionMedium,
  high: ToolConfirmationOutcome.ProceedNewSessionHigh,
} satisfies Record<RuntimeAutonomyLevel, ToolConfirmationOutcome>;

/** Prefer the current autonomy without changing SDK options or the default session destination. */
export function planApprovalOptions(
  request: RuntimePermissionRequest,
  autonomy: RuntimeAutonomyLevel | undefined,
): RuntimePermissionRequest['options'] {
  if (autonomy === undefined ||
      !request.toolUses.some((tool) => tool.confirmationKind === 'exit_spec_mode')) return request.options;
  const primary = request.options.find((option) =>
    !option.requiresEditedSpec && !/cancel|deny|reject/i.test(`${option.value} ${option.label}`),
  );
  const value = primary?.value;
  let approvals: Record<RuntimeAutonomyLevel, ToolConfirmationOutcome> | undefined;
  if (Object.values(newSessionApproval).some((option) => option === value)) {
    approvals = newSessionApproval;
  } else if (value === ToolConfirmationOutcome.ProceedAutoRun ||
      Object.values(sameSessionApproval).some((option) => option === value)) {
    approvals = sameSessionApproval;
  }
  const preferredValue = approvals?.[autonomy];
  const preferred = request.options.find((option) =>
    option.value === preferredValue && !option.requiresEditedSpec,
  );
  return preferred === undefined || preferred === primary ? request.options
    : [preferred, ...request.options.filter((option) => option !== preferred)];
}
