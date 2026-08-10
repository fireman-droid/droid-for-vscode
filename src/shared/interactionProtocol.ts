export const MAX_BRIDGE_ID_LENGTH = 256;
export const MAX_PERMISSION_TOOL_NAME_LENGTH = 80;
export const MAX_INTERACTION_TITLE_LENGTH = 512;
export const MAX_PERMISSION_OPTION_LABEL_LENGTH = 512;
export const MAX_ASK_USER_TOPIC_LENGTH = 512;
export const MAX_INTERACTION_DETAIL_LENGTH = 32_768;
export const MAX_ASK_USER_QUESTION_LENGTH =
  MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_ASK_USER_OPTION_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_ASK_USER_ANSWER_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_EDITED_SPEC_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
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

export type PermissionConfirmationKind =
  (typeof PERMISSION_CONFIRMATION_KINDS)[number];
