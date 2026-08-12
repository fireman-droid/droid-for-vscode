import type {
  ImageMediaType,
  ImageOrigin,
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
