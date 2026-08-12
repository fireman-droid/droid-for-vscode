import type {
  ImageMediaType,
  ImageOrigin,
  ToolBackgroundHint,
  ToolDetailKind,
} from '../shared/bridgeMessages';
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
      /** Workspace-relative path changed by file-modifying tools. */
      filePath?: string;
      /** Present together with `detail`. */
      detailKind?: ToolDetailKind;
      /** Command or plan text extracted from the tool input. */
      detail?: string;
      /**
       * Fail-soft `fireAndForget` read from an Execute tool input:
       * the CLI detached the command as a background process.
       */
      backgroundHint?: ToolBackgroundHint;
    }
  | {
      type: 'tool-progress';
      toolName: string;
      toolUseId: string;
      action: string;
      updateKind: ToolActivityUpdateKind;
      /**
       * Sanitized trailing command output for execute-class tools
       * (bounded to `MAX_TOOL_OUTPUT_TAIL_LENGTH`). Display-only:
       * feeds the live output preview and must never enter
       * diagnostics logs.
       */
      outputTail?: string;
    }
  | {
      type: 'tool-result';
      toolName: string;
      toolUseId: string;
      action: string;
      isError: boolean;
      /** Bounded text excerpt from a failed tool_result's content. */
      errorText?: string;
    }
  | {
      type: 'user-message';
      messageId: string;
    }
  | {
      /**
       * One bounded image block from the live stream: an assistant
       * `create_message` image or an image embedded in a tool result.
       * `data` is pure base64; empty means the image exceeded
       * `MAX_IMAGE_DATA_LENGTH` and only `byteLength` survives.
       */
      type: 'image-block';
      origin: ImageOrigin;
      mediaType: ImageMediaType;
      data: string;
      generated: boolean;
      byteLength: number;
      /** Message id or toolUseId anchoring the block. */
      sourceId: string;
      blockIndex: number;
    }
  | {
      type: 'working-state';
      isWorking: boolean;
    }
  | {
      type: 'settings-updated';
    }
  | {
      /**
       * A ProceedNewSession* spec approval handed implementation off to
       * a fresh Droid session. Emitted before `turn-complete` so the
       * host can adopt the implementation session once the turn ends.
       */
      type: 'spec-handoff';
      implementationSessionId: string;
    }
  | {
      /**
       * The active turn delegated work to a subagent (Task tool),
       * projected from the `child_session_available` session
       * notification. The child session id is dropped here on
       * purpose so it never leaves the Runtime.
       */
      type: 'subagent-started';
      /** Parent Task tool call this subagent hangs under, if known. */
      toolUseId: string | null;
      subagentType: string;
      description: string;
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
