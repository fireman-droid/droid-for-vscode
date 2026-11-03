export const MAX_BRIDGE_ID_LENGTH = 256;
export const MAX_PERMISSION_TOOL_NAME_LENGTH = 80;
export const MAX_INTERACTION_TITLE_LENGTH = 512;
export const MAX_PERMISSION_OPTION_LABEL_LENGTH = 512;
export const MAX_ASK_USER_TOPIC_LENGTH = 512;
export const MAX_INTERACTION_DETAIL_LENGTH = 32_768;
export const MAX_ASK_USER_QUESTION_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_ASK_USER_OPTION_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_ASK_USER_ANSWER_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
/**
 * Dedicated cap for ExitSpecMode plan text: real spec documents are
 * multi-chapter Markdown that regularly exceeds the generic 32K detail
 * cap, and an over-limit plan must degrade visibly (truncation) rather
 * than silently cancelling the whole approval.
 */
export const MAX_SPEC_PLAN_LENGTH = 262_144;
export const MAX_EDITED_SPEC_LENGTH = MAX_SPEC_PLAN_LENGTH;
export const MAX_PERMISSION_RISK_NOTE_LENGTH = 4_096;
export const MAX_PERMISSION_OPTION_VALUE_LENGTH = 512;
export const MAX_PERMISSION_TOOLS = 32;
export const MAX_PERMISSION_OPTIONS = 32;
export const MAX_ASK_USER_QUESTIONS = 4;
export const MAX_ASK_USER_OPTIONS = 4;
export const MAX_ASK_USER_ANSWERS = 4;

// Keep this closed list aligned with the SDK's ToolConfirmationType values.
export const PERMISSION_CONFIRMATION_KINDS = [
  'edit',
  'exec',
  'create',
  'ask_user',
  'exit_spec_mode',
  'propose_mission',
  'start_mission_run',
  'apply_patch',
  'mcp_tool',
  'sandbox_violation',
  'droid_shield_violation',
] as const;

export type PermissionConfirmationKind = (typeof PERMISSION_CONFIRMATION_KINDS)[number];

/** Opens or focuses the editable Markdown document for one pending Plan. */
export interface PlanDocumentOpenMessage {
  readonly type: 'plan.document.open';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
}

export interface AskUserResultAnswer {
  readonly topic: string;
  readonly question?: string;
  readonly answer: string;
}

export interface PermissionRespondMessage {
  readonly type: 'permission.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly selectedOption: string;
  readonly editedSpecContent?: string;
}

export interface AskUserAnswer {
  readonly index: number;
  readonly answer: string;
}

export interface AskUserRespondMessage {
  readonly type: 'ask-user.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly cancelled: boolean;
  readonly answers: readonly AskUserAnswer[];
}

export type AskUserInteractionResult =
  | {
      readonly status: 'answered';
      readonly answers: readonly AskUserResultAnswer[];
    }
  | {
      readonly status: 'cancelled';
    };

interface AskUserResultTranscriptBase {
  readonly id: string;
  readonly kind: 'ask-user-result';
  readonly turnId: string;
}

/** Compact, durable echo of one settled AskUser interaction. */
export type AskUserResultTranscriptItem =
  | (AskUserResultTranscriptBase & {
      readonly status: 'answered';
      readonly answers: readonly AskUserResultAnswer[];
    })
  | (AskUserResultTranscriptBase & {
      readonly status: 'cancelled';
    });

export const PLAN_DOCUMENT_STATUSES = ['ready', 'too-large', 'closed', 'failed'] as const;
export type PlanDocumentStatus = (typeof PLAN_DOCUMENT_STATUSES)[number];

/** Latest Host-owned draft state for one pending ExitSpecMode Plan. */
export interface PlanDocumentStateMessage {
  readonly type: 'plan.document.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly status: PlanDocumentStatus;
  readonly content?: string;
}

export function isImplicitMultiSelectQuestion(question: string, topic = ''): boolean {
  const text = `${topic}\n${question}`;
  if (/(?:不可|不能|不支持|不允许|禁止|不是|非)多选|(?:仅|只)(?:限|能|可)?单选/u.test(text)) {
    return false;
  }
  const hasMultiSelectHint =
    /(?:可|支持|允许|可以)(?:单选[、/或与及和]?)?多选|单选[、/或与及和]多选|多选题|多项选择|可(?:选|勾选)多(?:个|项)|(?:一个|1\s*个)或多个|多个选项/u.test(
      text,
    ) ||
    /[（([【][^)）】\]]*(?:多选|multi(?:-?select)?|\bmulti\b)[^)）】\]]*[)）】\]]/iu.test(
      text,
    ) ||
    /^(?:多选|multi(?:-?select)?)$/iu.test(topic.trim()) ||
    /\b(?:select|choose|check)\s+(?:all\s+that\s+apply|one\s+or\s+more|multiple)\b|\bmulti(?:ple)?[-\s]select\b/iu.test(
      text,
    );
  if (hasMultiSelectHint) {
    return true;
  }
  return false;
}
