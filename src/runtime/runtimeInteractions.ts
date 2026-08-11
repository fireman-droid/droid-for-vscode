import {
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type AskUserRequestParams,
  type AskUserResult,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type RequestPermissionHandlerResult,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';
import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  type PermissionConfirmationKind,
} from '../shared/interactionProtocol';

export const MAX_RUNTIME_PERMISSION_TOOL_USES = MAX_PERMISSION_TOOLS;
export const MAX_RUNTIME_PERMISSION_OPTIONS = MAX_PERMISSION_OPTIONS;
export const MAX_RUNTIME_ASK_USER_QUESTIONS = MAX_ASK_USER_QUESTIONS;
export const MAX_RUNTIME_ASK_USER_OPTIONS = MAX_ASK_USER_OPTIONS;
export const MAX_RUNTIME_IDENTIFIER_LENGTH = MAX_BRIDGE_ID_LENGTH;
export const MAX_RUNTIME_TITLE_LENGTH = MAX_INTERACTION_TITLE_LENGTH;
export const MAX_RUNTIME_DETAIL_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_RUNTIME_RISK_NOTE_LENGTH =
  MAX_PERMISSION_RISK_NOTE_LENGTH;
export const MAX_RUNTIME_ANSWER_LENGTH = MAX_ASK_USER_ANSWER_LENGTH;
export const RUNTIME_CONFIRMATION_KINDS =
  PERMISSION_CONFIRMATION_KINDS;

export type RuntimeConfirmationKind = PermissionConfirmationKind;

export interface RuntimePermissionOption {
  readonly label: string;
  readonly value: string;
  readonly requiresEditedSpec: boolean;
}

export interface RuntimePermissionToolSummary {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly confirmationKind: RuntimeConfirmationKind;
  readonly title: string;
  readonly detail?: string;
  readonly riskNote?: string;
  readonly editableSpecContent?: string;
}

export interface RuntimePermissionRequest {
  readonly options: readonly RuntimePermissionOption[];
  readonly toolUses: readonly RuntimePermissionToolSummary[];
}

export interface RuntimePermissionResult {
  readonly selectedOption: string;
  readonly editedSpecContent?: string;
}

export interface RuntimeAskUserQuestion {
  readonly index: number;
  readonly topic: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

export interface RuntimeAskUserRequest {
  readonly toolCallId: string;
  readonly questions: readonly RuntimeAskUserQuestion[];
}

export interface RuntimeAskUserAnswer {
  readonly index: number;
  readonly answer: string;
}

export interface RuntimeAskUserResult {
  readonly cancelled?: boolean;
  readonly answers: readonly RuntimeAskUserAnswer[];
}

export interface RuntimeInteractionHandler {
  requestPermission(
    request: RuntimePermissionRequest,
  ): Promise<RuntimePermissionResult>;
  askUser(request: RuntimeAskUserRequest): Promise<RuntimeAskUserResult>;
}

export interface RuntimeInteractionCallbacks {
  readonly permissionHandler: ClientPermissionHandler;
  readonly askUserHandler: ClientAskUserHandler;
}

export const cancellingRuntimeInteractionHandler: RuntimeInteractionHandler = {
  async requestPermission() {
    return { selectedOption: ToolConfirmationOutcome.Cancel };
  },
  async askUser() {
    return { cancelled: true, answers: [] };
  },
};

export function createRuntimeInteractionCallbacks(
  handler: RuntimeInteractionHandler,
): RuntimeInteractionCallbacks {
  return {
    permissionHandler: async (params) =>
      handlePermissionRequest(handler, params),
    askUserHandler: async (params) => handleAskUserRequest(handler, params),
  };
}

export function permissionOptionRequiresEditedSpec(
  value: string,
): boolean {
  return value === ToolConfirmationOutcome.ProceedEdit;
}

async function handlePermissionRequest(
  handler: RuntimeInteractionHandler,
  params: RequestPermissionRequestParams,
): Promise<RequestPermissionHandlerResult> {
  let request: RuntimePermissionRequest | null;
  try {
    request = projectPermissionRequest(params);
  } catch {
    return ToolConfirmationOutcome.Cancel;
  }
  if (!request) {
    return ToolConfirmationOutcome.Cancel;
  }

  const suppliedOptions = new Map(
    request.options.map((option) => [option.value, option]),
  );

  try {
    const result = await handler.requestPermission(request);
    if (
      !isRecord(result) ||
      typeof result.selectedOption !== 'string' ||
      !suppliedOptions.has(result.selectedOption)
    ) {
      return ToolConfirmationOutcome.Cancel;
    }

    const selectedOption = suppliedOptions.get(result.selectedOption);
    if (!selectedOption?.requiresEditedSpec) {
      return result.selectedOption as RequestPermissionHandlerResult;
    }

    if (
      !isBoundedString(
        result.editedSpecContent,
        MAX_EDITED_SPEC_LENGTH,
      )
    ) {
      return ToolConfirmationOutcome.Cancel;
    }

    return {
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: result.editedSpecContent,
    };
  } catch {
    return ToolConfirmationOutcome.Cancel;
  }
}

async function handleAskUserRequest(
  handler: RuntimeInteractionHandler,
  params: AskUserRequestParams,
): Promise<AskUserResult> {
  let request: RuntimeAskUserRequest | null;
  try {
    request = projectAskUserRequest(params);
  } catch {
    return cancelledAskUserResult();
  }
  if (!request) {
    return cancelledAskUserResult();
  }

  try {
    const result = await handler.askUser(request);
    if (
      !isRecord(result) ||
      (result.cancelled !== undefined &&
        typeof result.cancelled !== 'boolean') ||
      result.cancelled === true ||
      !Array.isArray(result.answers)
    ) {
      return cancelledAskUserResult();
    }

    const answersByIndex = new Map<number, string>();
    for (const answer of result.answers) {
      if (
        !isRecord(answer) ||
        typeof answer.index !== 'number' ||
        !Number.isSafeInteger(answer.index) ||
        answer.index < 0 ||
        !isNonEmptyBoundedString(
          answer.answer,
          MAX_RUNTIME_ANSWER_LENGTH,
        ) ||
        answersByIndex.has(answer.index)
      ) {
        return cancelledAskUserResult();
      }
      answersByIndex.set(answer.index, answer.answer);
    }

    if (answersByIndex.size !== params.questions.length) {
      return cancelledAskUserResult();
    }

    const answers: AskUserResult['answers'] = [];
    for (const { index, question } of params.questions) {
      const answer = answersByIndex.get(index);
      if (answer === undefined) {
        return cancelledAskUserResult();
      }
      answers.push({ index, question, answer });
    }

    return { answers };
  } catch {
    return cancelledAskUserResult();
  }
}

function projectPermissionRequest(
  params: RequestPermissionRequestParams,
): RuntimePermissionRequest | null {
  if (
    params.toolUses.length === 0 ||
    params.toolUses.length > MAX_RUNTIME_PERMISSION_TOOL_USES ||
    params.options.length === 0 ||
    params.options.length > MAX_RUNTIME_PERMISSION_OPTIONS
  ) {
    return null;
  }

  const options: RuntimePermissionOption[] = [];
  for (const option of params.options) {
    if (
      !isNonEmptyBoundedString(
        option.label,
        MAX_PERMISSION_OPTION_LABEL_LENGTH,
      ) ||
      !isNonEmptyBoundedString(
        option.value,
        MAX_PERMISSION_OPTION_VALUE_LENGTH,
      )
    ) {
      return null;
    }
    options.push({
      label: option.label,
      value: option.value,
      requiresEditedSpec: permissionOptionRequiresEditedSpec(option.value),
    });
  }

  const toolUses: RuntimePermissionToolSummary[] = [];
  for (const toolUse of params.toolUses) {
    if (
      !isNonEmptyBoundedString(
        toolUse.toolUse.id,
        MAX_BRIDGE_ID_LENGTH,
      ) ||
      !isNonEmptyBoundedString(
        toolUse.toolUse.name,
        MAX_PERMISSION_TOOL_NAME_LENGTH,
      ) ||
      toolUse.confirmationType !== toolUse.details.type
    ) {
      return null;
    }

    const summary = projectPermissionTool(toolUse);
    if (!summary) {
      return null;
    }

    toolUses.push({
      toolUseId: toolUse.toolUse.id,
      toolName: toolUse.toolUse.name,
      ...summary,
    });
  }

  if (
    options.some(({ requiresEditedSpec }) => requiresEditedSpec) &&
    !toolUses.some(
      ({ confirmationKind, editableSpecContent }) =>
        confirmationKind === 'exit_spec_mode' &&
        editableSpecContent !== undefined,
    )
  ) {
    return null;
  }

  return { options, toolUses };
}

function projectPermissionTool(
  toolUse: RequestPermissionRequestParams['toolUses'][number],
): Omit<RuntimePermissionToolSummary, 'toolUseId' | 'toolName'> | null {
  const details = toolUse.details;

  switch (details.type) {
    case ToolConfirmationType.Edit:
      return summary(
        'edit',
        prefixed('Edit ', details.fileName, MAX_INTERACTION_TITLE_LENGTH),
        boundedDetail([
          prefixed('Path: ', details.filePath),
          optionalSection('Current content', details.oldContent),
          optionalSection('Proposed content', details.newContent),
        ]),
      );

    case ToolConfirmationType.Execute:
      return summary(
        'exec',
        prefixed('Run ', details.command, MAX_INTERACTION_TITLE_LENGTH),
        boundedDetail([
          details.fullCommand,
          optionalList('Extracted commands', details.extractedCommands),
        ]),
        boundedDetail(
          [
            optionalLine('Impact', details.impactLevel),
            details.riskLevelReason,
          ],
          MAX_RUNTIME_RISK_NOTE_LENGTH,
        ),
      );

    case ToolConfirmationType.Create:
      return summary(
        'create',
        prefixed('Create ', details.fileName, MAX_INTERACTION_TITLE_LENGTH),
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
              MAX_RUNTIME_RISK_NOTE_LENGTH,
            )
          : undefined,
      );

    case ToolConfirmationType.ExitSpecMode:
      return summary(
        'exit_spec_mode',
        details.title ?? 'Exit spec mode',
        details.plan,
        undefined,
        details.plan,
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
        prefixed(
          'Apply patch to ',
          details.fileName,
          MAX_INTERACTION_TITLE_LENGTH,
        ),
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
        prefixed(
          'Run MCP tool ',
          details.toolName,
          MAX_INTERACTION_TITLE_LENGTH,
        ),
        boundedDetail([
          optionalLine('Server', details.serverName),
          optionalLine('Tool', details.actualToolName),
        ]),
        boundedDetail(
          [prefixed('Impact: ', details.impactLevel)],
          MAX_RUNTIME_RISK_NOTE_LENGTH,
        ),
      );

    case ToolConfirmationType.SandboxViolation:
      return summary(
        'sandbox_violation',
        prefixed(
          'Allow sandbox exception for ',
          details.violatingToolName,
          MAX_INTERACTION_TITLE_LENGTH,
        ),
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
          MAX_RUNTIME_RISK_NOTE_LENGTH,
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

function projectAskUserRequest(
  params: AskUserRequestParams,
): RuntimeAskUserRequest | null {
  if (
    !isNonEmptyBoundedString(params.toolCallId, MAX_BRIDGE_ID_LENGTH) ||
    params.questions.length === 0 ||
    params.questions.length > MAX_RUNTIME_ASK_USER_QUESTIONS
  ) {
    return null;
  }

  const seenIndices = new Set<number>();
  const questions: RuntimeAskUserQuestion[] = [];

  for (const question of params.questions) {
    if (
      !Number.isSafeInteger(question.index) ||
      question.index < 0 ||
      seenIndices.has(question.index) ||
      !isBoundedString(question.topic, MAX_ASK_USER_TOPIC_LENGTH) ||
      !isNonEmptyBoundedString(
        question.question,
        MAX_ASK_USER_QUESTION_LENGTH,
      ) ||
      question.options.length > MAX_RUNTIME_ASK_USER_OPTIONS ||
      !question.options.every((option) =>
        isNonEmptyBoundedString(option, MAX_ASK_USER_OPTION_LENGTH),
      ) ||
      (question.multiSelect !== undefined &&
        typeof question.multiSelect !== 'boolean')
    ) {
      return null;
    }

    seenIndices.add(question.index);
    questions.push({
      index: question.index,
      topic: question.topic,
      question: question.question,
      options: [...question.options],
      multiSelect: question.multiSelect ?? false,
    });
  }

  return { toolCallId: params.toolCallId, questions };
}

function summary(
  confirmationKind: RuntimeConfirmationKind,
  title: string | null,
  projectedDetail?: string | null,
  riskNote?: string | null,
  editableSpecContent?: string,
): Omit<RuntimePermissionToolSummary, 'toolUseId' | 'toolName'> | null {
  if (
    !isNonEmptyBoundedString(title, MAX_RUNTIME_TITLE_LENGTH) ||
    projectedDetail === null ||
    (projectedDetail !== undefined &&
      !isBoundedString(projectedDetail, MAX_RUNTIME_DETAIL_LENGTH)) ||
    riskNote === null ||
    (riskNote !== undefined &&
      !isBoundedString(riskNote, MAX_RUNTIME_RISK_NOTE_LENGTH)) ||
    (editableSpecContent !== undefined &&
      !isBoundedString(editableSpecContent, MAX_RUNTIME_DETAIL_LENGTH))
  ) {
    return null;
  }

  return {
    confirmationKind,
    title,
    ...(projectedDetail ? { detail: projectedDetail } : {}),
    ...(riskNote ? { riskNote } : {}),
    ...(editableSpecContent !== undefined ? { editableSpecContent } : {}),
  };
}

function boundedDetail(
  values: readonly (string | undefined | null)[],
  maximumLength = MAX_RUNTIME_DETAIL_LENGTH,
): string | null | undefined {
  const present: string[] = [];
  let length = 0;
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    if (value === null || !isBoundedString(value, maximumLength)) {
      return null;
    }
    if (value.length === 0) {
      continue;
    }

    const separatorLength = present.length === 0 ? 0 : 2;
    if (length + separatorLength + value.length > maximumLength) {
      return null;
    }
    length += separatorLength + value.length;
    present.push(value);
  }

  if (present.length === 0) {
    return undefined;
  }

  return present.join('\n\n');
}

function prefixed(
  prefix: string,
  value: string,
  maximumLength = MAX_RUNTIME_DETAIL_LENGTH,
): string | null {
  if (
    !isBoundedString(value, maximumLength) ||
    prefix.length + value.length > maximumLength
  ) {
    return null;
  }
  return `${prefix}${value}`;
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
  if (values.length > MAX_PERMISSION_TOOLS) {
    return null;
  }

  const heading = `${label}:`;
  const parts = [heading];
  let length = heading.length;
  for (const value of values) {
    if (
      !isBoundedString(value, MAX_RUNTIME_DETAIL_LENGTH) ||
      length + 1 + value.length > MAX_RUNTIME_DETAIL_LENGTH
    ) {
      return null;
    }
    length += 1 + value.length;
    parts.push(value);
  }
  return parts.join('\n');
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cancelledAskUserResult(): AskUserResult {
  return { cancelled: true, answers: [] };
}
