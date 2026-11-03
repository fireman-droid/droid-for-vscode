import {
  ToolConfirmationType,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';
import {
  MAX_BRIDGE_ID_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SPEC_PLAN_LENGTH,
  type PermissionConfirmationKind,
} from '../../shared/protocol/interactionProtocol';

type PermissionToolUse = RequestPermissionRequestParams['toolUses'][number];

/**
 * SDK Script confirmation: a batch of nested tool confirmations that the
 * user approves or denies as a whole.
 */
export type ScriptConfirmationDetails = Extract<
  PermissionToolUse['details'],
  { type: ToolConfirmationType.Script }
>;

/** A single nested confirmation carried by a Script batch. */
export type DirectConfirmationDetails =
  ScriptConfirmationDetails['calls'][number]['confirmation'];

export interface ProjectedPermissionTool {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly confirmationKind: PermissionConfirmationKind;
  readonly title: string;
  readonly detail?: string;
  readonly riskNote?: string;
  readonly editableSpecContent?: string;
}

/**
 * Projects one SDK permission tool use into the flat summaries the bridge
 * carries. A Script batch keeps atomic approve/deny options and explicitly
 * marks any operations omitted by the display bound.
 */
export function projectPermissionToolUse(
  toolUse: PermissionToolUse,
): ProjectedPermissionTool[] | null {
  if (
    !isNonEmptyBoundedString(toolUse.toolUse.id, MAX_BRIDGE_ID_LENGTH) ||
    !isNonEmptyBoundedString(toolUse.toolUse.name, MAX_PERMISSION_TOOL_NAME_LENGTH) ||
    toolUse.confirmationType !== toolUse.details.type
  ) {
    return null;
  }

  const projected =
    toolUse.details.type === ToolConfirmationType.Script
      ? projectScriptTool(toolUse.details)
      : projectDirectConfirmation(toolUse.details);
  if (!projected) {
    return null;
  }

  return [{ toolUseId: toolUse.toolUse.id, toolName: toolUse.toolUse.name, ...projected }];
}

function projectDirectConfirmation(
  details: Exclude<PermissionToolUse['details'], { type: ToolConfirmationType.Script }>,
): Omit<ProjectedPermissionTool, 'toolUseId' | 'toolName'> | null {
  switch (details.type) {
    case ToolConfirmationType.Edit:
      return summary(
        'edit',
        prefixed('Edit ', details.fileName),
        boundedDetail([
          prefixed('Path: ', details.filePath),
          optionalSection('Current content', details.oldContent),
          optionalSection('Proposed content', details.newContent),
        ]),
      );

    case ToolConfirmationType.Execute:
      return summary(
        'exec',
        prefixed('Run ', details.command),
        boundedDetail([
          details.fullCommand,
          optionalList('Extracted commands', details.extractedCommands),
        ]),
        boundedDetail(
          [optionalLine('Impact', details.impactLevel), details.riskLevelReason],
          MAX_PERMISSION_RISK_NOTE_LENGTH,
        ),
      );

    case ToolConfirmationType.Create:
      return summary(
        'create',
        prefixed('Create ', details.fileName),
        boundedDetail([
          prefixed('Path: ', details.filePath),
          prefixed('Content:\n', details.content),
        ]),
      );

    case ToolConfirmationType.AskUser:
      return summary(
        'ask_user',
        'Ask user',
        boundedDetail([
          details.questionnaire,
          optionalLine('Parse error', details.parseError?.message),
        ]),
        details.parseError
          ? boundedDetail(
              [
                details.parseError.message,
                details.parseError.line === undefined
                  ? undefined
                  : `Line: ${details.parseError.line}`,
              ],
              MAX_PERMISSION_RISK_NOTE_LENGTH,
            )
          : undefined,
      );

    case ToolConfirmationType.ExitSpecMode: {
      // Plans get their own generous cap; anything beyond it is
      // truncated for display and editing instead of cancelling the
      // approval, because approving does not send the plan back and a
      // silent cancel would drop the interaction without a trace.
      const plan =
        typeof details.plan === 'string'
          ? details.plan.slice(0, MAX_SPEC_PLAN_LENGTH)
          : details.plan;
      return summary(
        'exit_spec_mode',
        details.title ?? 'Exit spec mode',
        plan,
        undefined,
        plan,
        MAX_SPEC_PLAN_LENGTH,
      );
    }

    case ToolConfirmationType.RecommendMission:
      return summary(
        'recommend_mission',
        'Recommend mission',
        details.reason,
      );

    case ToolConfirmationType.ProposeMission:
      return summary(
        'propose_mission',
        details.title ?? 'Propose mission',
        details.proposal,
      );

    case ToolConfirmationType.StartMissionRun:
      return summary(
        'start_mission_run',
        'Start mission run',
        boundedDetail([
          `Running missions: ${details.runningMissionCount}`,
          optionalList('Running session IDs', details.runningMissionSessionIds),
        ]),
      );

    case ToolConfirmationType.ApplyPatch:
      return summary(
        'apply_patch',
        prefixed('Apply patch to ', details.fileName),
        boundedDetail([
          prefixed('Path: ', details.filePath),
          prefixed('Patch:\n', details.patchContent),
          optionalSection('Current content', details.oldContent),
          optionalSection('Proposed content', details.newContent),
        ]),
      );

    case ToolConfirmationType.McpTool:
      return summary(
        'mcp_tool',
        prefixed('Run MCP tool ', details.toolName),
        boundedDetail([
          optionalLine('Server', details.serverName),
          optionalLine('Tool', details.actualToolName),
        ]),
        boundedDetail(
          [prefixed('Impact: ', details.impactLevel)],
          MAX_PERMISSION_RISK_NOTE_LENGTH,
        ),
      );

    case ToolConfirmationType.SandboxViolation:
      return summary(
        'sandbox_violation',
        prefixed('Allow sandbox exception for ', details.violatingToolName),
        boundedDetail([
          prefixed('Operation: ', details.operationType),
          prefixed('Target: ', details.target),
          prefixed('Violation: ', details.violationType),
        ]),
        boundedDetail(
          [
            details.reason,
            optionalLine('Violation reason', details.violationReason),
            details.isOrgDeny ? 'Blocked by organization policy' : undefined,
          ],
          MAX_PERMISSION_RISK_NOTE_LENGTH,
        ),
      );

    case ToolConfirmationType.DroidShieldViolation:
      return summary(
        'droid_shield_violation',
        'Allow blocked command',
        details.command,
        details.reason,
      );

    default:
      return null;
  }
}

function projectScriptTool(
  details: ScriptConfirmationDetails,
): Omit<ProjectedPermissionTool, 'toolUseId' | 'toolName'> | null {
  const sections: string[] = [];
  for (const [index, call] of details.calls.entries()) {
    const confirmation = projectDirectConfirmation(call.confirmation);
    if (!confirmation) {
      return null;
    }
    if (index < MAX_PERMISSION_TOOLS) sections.push(scriptCallSection(call, confirmation));
  }
  if (details.calls.length > MAX_PERMISSION_TOOLS) {
    sections.push(
      `${DETAIL_TRUNCATION_MARKER} ${details.calls.length - MAX_PERMISSION_TOOLS} more operations`,
    );
  }
  if (sections.length === 0) {
    sections.push('No operations were listed for this script.');
  }

  const count = details.calls.length;
  return summary(
    'script',
    `Run script · ${count} ${count === 1 ? 'operation' : 'operations'}`,
    sections.join('\n\n'),
    prefixed('Impact: ', details.impactLevel),
  );
}

function scriptCallSection(
  call: ScriptConfirmationDetails['calls'][number],
  confirmation: Omit<ProjectedPermissionTool, 'toolUseId' | 'toolName'>,
): string {
  const parts = [
    call.toolName,
    `Line ${call.line}, column ${call.column}`,
    ...(call.alwaysAsk ? ['Always requires approval'] : []),
    confirmation.title,
  ];
  if (confirmation.detail !== undefined) {
    parts.push(confirmation.detail);
  }
  if (confirmation.riskNote !== undefined) {
    parts.push(`Risk: ${confirmation.riskNote}`);
  }
  return parts.join('\n');
}

/**
 * Marks display text that was cut at a projection cap. Details, titles,
 * and risk notes are display-only (approving never sends them back), so
 * over-length values must degrade to visible truncation instead of
 * cancelling the whole approval. The 1m26s "ApplyPatch failed" incident
 * was a 35.8K patch detail silently auto-cancelling the permission card.
 */
const DETAIL_TRUNCATION_MARKER = '… (truncated)';

function truncateForDisplay(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }
  if (maximumLength <= DETAIL_TRUNCATION_MARKER.length + 1) {
    return value.slice(0, maximumLength);
  }
  return `${value.slice(
    0,
    maximumLength - DETAIL_TRUNCATION_MARKER.length - 1,
  )}\n${DETAIL_TRUNCATION_MARKER}`;
}

function summary(
  confirmationKind: PermissionConfirmationKind,
  title: string | null,
  projectedDetail?: string | null,
  riskNote?: string | null,
  editableSpecContent?: string,
  detailLengthLimit: number = MAX_INTERACTION_DETAIL_LENGTH,
): Omit<ProjectedPermissionTool, 'toolUseId' | 'toolName'> | null {
  // Null marks a type-level violation (a non-string where the SDK
  // promises a string) and still fails closed; over-length display
  // strings truncate instead.
  if (
    typeof title !== 'string' ||
    title.length === 0 ||
    projectedDetail === null ||
    (projectedDetail !== undefined && typeof projectedDetail !== 'string') ||
    riskNote === null ||
    (riskNote !== undefined && typeof riskNote !== 'string') ||
    (editableSpecContent !== undefined && typeof editableSpecContent !== 'string')
  ) {
    return null;
  }
  const boundedTitle =
    title.length <= MAX_INTERACTION_TITLE_LENGTH
      ? title
      : `${title.slice(0, MAX_INTERACTION_TITLE_LENGTH - 1)}…`;
  const detail =
    projectedDetail === undefined
      ? undefined
      : truncateForDisplay(projectedDetail, detailLengthLimit);
  const boundedRiskNote =
    riskNote === undefined
      ? undefined
      : truncateForDisplay(riskNote, MAX_PERMISSION_RISK_NOTE_LENGTH);
  const boundedSpecContent =
    editableSpecContent === undefined
      ? undefined
      : editableSpecContent.slice(0, detailLengthLimit);

  return {
    confirmationKind,
    title: boundedTitle,
    ...(detail ? { detail } : {}),
    ...(boundedRiskNote ? { riskNote: boundedRiskNote } : {}),
    ...(boundedSpecContent !== undefined
      ? { editableSpecContent: boundedSpecContent }
      : {}),
  };
}

function boundedDetail(
  values: readonly (string | undefined | null)[],
  maximumLength = MAX_INTERACTION_DETAIL_LENGTH,
): string | null | undefined {
  const present: string[] = [];
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    if (value === null || typeof value !== 'string') {
      return null;
    }
    if (value.length === 0) {
      continue;
    }
    present.push(value);
  }

  if (present.length === 0) {
    return undefined;
  }

  return truncateForDisplay(present.join('\n\n'), maximumLength);
}

function prefixed(prefix: string, value: string): string | null {
  return typeof value === 'string' ? `${prefix}${value}` : null;
}

function optionalLine(
  label: string,
  value: string | undefined,
): string | null | undefined {
  return value === undefined ? undefined : prefixed(`${label}: `, value);
}

function optionalSection(
  label: string,
  value: string | undefined,
): string | null | undefined {
  return value === undefined ? undefined : prefixed(`${label}:\n`, value);
}

function optionalList(
  label: string,
  values: readonly string[] | undefined,
): string | null | undefined {
  if (values === undefined) {
    return undefined;
  }

  const parts = [`${label}:`];
  for (const value of values.slice(0, MAX_PERMISSION_TOOLS)) {
    if (typeof value !== 'string') {
      return null;
    }
    parts.push(value);
  }
  if (values.length > MAX_PERMISSION_TOOLS) {
    parts.push(DETAIL_TRUNCATION_MARKER);
  }
  return parts.join('\n');
}

export function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

export function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}
