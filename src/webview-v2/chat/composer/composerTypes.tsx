import type { SessionCommandsState } from '../../../shared/protocol/settings';

export type SlashCommandsState =
  | SessionCommandsState
  | {
      readonly status: 'idle';
      readonly items: readonly [];
      readonly recent: readonly [];
    };
