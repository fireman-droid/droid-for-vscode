import type { ToolActivityUpdateKind } from '../shared/toolActivity';

export type RuntimeAvailability =
  | {
      status: 'available';
      sdkVersion: string;
      cliVersion: null;
      authenticationStatus: 'unknown';
      sessionId: string;
    }
  | {
      status: 'unavailable';
      sdkVersion: string;
      cliVersion: null;
      authenticationStatus: 'unknown';
      reason:
        | 'cli-not-found'
        | 'invalid-cwd'
        | 'initialization-failed';
      message: string;
    };

export type RuntimeEvent =
  | {
      type: 'text-delta';
      text: string;
    }
  | {
      type: 'thinking-delta';
      text: string;
    }
  | {
      type: 'thinking-complete';
      durationMs: number | null;
    }
  | {
      type: 'tool-start';
      toolName: string;
      toolUseId: string;
      action: string;
    }
  | {
      type: 'tool-progress';
      toolName: string;
      toolUseId: string;
      action: string;
      updateKind: ToolActivityUpdateKind;
    }
  | {
      type: 'tool-result';
      toolName: string;
      toolUseId: string;
      action: string;
      isError: boolean;
    }
  | {
      type: 'user-message';
      messageId: string;
    }
  | {
      type: 'working-state';
      isWorking: boolean;
    }
  | {
      type: 'settings-updated';
    }
  | {
      type: 'error';
    }
  | {
      type: 'turn-complete';
      outcome:
        | 'success'
        | 'interrupted'
        | 'error_during_execution'
        | 'error_structured_output';
    };
