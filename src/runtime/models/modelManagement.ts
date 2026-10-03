import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AutonomyLevel,
  DroidInteractionMode,
  ToolConfirmationOutcome,
} from '@factory/droid-sdk';
import type { ModelVerification } from '../../shared/protocol/modelManagerProtocol';
import type { DaemonApi, DaemonSessionHandle } from '../daemon/api';

export interface SavedModel {
  readonly rawIndex: number;
  readonly model: string;
  readonly provider: string;
  readonly displayName?: string;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly apiKeyMask?: string;
  readonly maxOutputTokens?: number;
  readonly noImageSupport?: boolean;
  readonly hasBedrockConfig: boolean;
  readonly isValid: boolean;
}

export interface ModelWrite {
  readonly rawIndex?: number;
  readonly expectedModel?: string;
  readonly model: string;
  readonly displayName?: string;
  readonly provider: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly maxOutputTokens?: number | null;
  readonly noImageSupport?: boolean | null;
}

export interface LoadedModel {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly disabledReason: string | null;
}

export interface ModelManagementGateway {
  list(): Promise<readonly SavedModel[]>;
  loaded(): Promise<readonly LoadedModel[]>;
  save(input: ModelWrite): Promise<void>;
  delete(rawIndex: number, expectedModel: string): Promise<void>;
  verify(runtimeId: string, signal: AbortSignal): Promise<ModelVerification>;
}

export function createModelManagementGateway(
  getDaemon: () => Promise<DaemonApi>,
  // Verification uses the shared daemon without allocating an IDE-bound daemon
  // rooted in its temporary directory, which would keep that directory locked.
  getVerificationDaemon: () => Promise<DaemonApi> = getDaemon,
): ModelManagementGateway {
  return {
    list: async () => (await getDaemon()).customModels.list(),
    loaded: async () => {
      const models = await (await getDaemon()).models.list({ includeDisabled: true });
      return models
        .filter((model) => model.isCustom)
        .map((model) => ({
          id: model.id,
          displayName: model.displayName,
          provider: model.modelProvider,
          disabledReason: model.disabled === true
            ? model.disabledReason.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim().slice(0, 512)
            : null,
        }));
    },
    save: async (input) => {
      const result = await (await getDaemon()).customModels.upsert(input);
      if (!result.success) throw new Error('Droid did not confirm the model write.');
    },
    delete: async (rawIndex, expectedModel) => {
      const result = await (
        await getDaemon()
      ).customModels.delete({ rawIndex, expectedModel });
      if (!result.success) throw new Error('Droid did not confirm the model deletion.');
    },
    verify: async (runtimeId, signal) =>
      verifyThroughDroid(await getVerificationDaemon(), runtimeId, signal),
  };
}

/** Classify only known failure signals; never publish upstream bodies or credentials. */
export function modelFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const configurationErrors = [
    ['Custom model entry not found', '模型配置已被删除或移动，请刷新模型列表后重试。'],
    ['Custom models changed on disk; refresh and try again', 'Droid 设置已被其他操作修改，请刷新后重新保存。'],
    ['Custom model configuration is invalid', 'Droid 判定该模型的完整配置无效，修改别名也会被拒绝。请检查 settings.json 中该模型的接口和额外参数。'],
    ['Base URL is required', '此模型缺少接口地址，请先补充 Base URL。'],
    ['Base URL must be a valid URL', '此模型的接口地址无效，请修正 Base URL。'],
    ['Invalid custom model request; check field names and values', 'Droid 未接受模型配置字段，请检查配置并确认 CLI 与扩展版本。'],
    ['Custom models are disabled by your organization policy', '组织策略禁止使用自定义模型，无法保存此配置。'],
    ['Base URL is not allowed by your organization policy', '组织策略不允许此接口地址，无法保存此配置。'],
  ] as const;
  for (const [cause, message] of configurationErrors) {
    if (text.includes(cause)) return message;
  }
  if (/\b401\b|unauthori[sz]ed|invalid.api.key/i.test(text))
    return 'Authentication failed. Check the API key.';
  if (/\b403\b|forbidden|permission.denied/i.test(text))
    return 'This key does not have access to the model.';
  if (/\b404\b|model.not.found|unknown.model/i.test(text))
    return 'Model or endpoint not found. Check the exact Model ID and Base URL.';
  if (/\b429\b|rate.limit|quota|insufficient.credit/i.test(text))
    return 'The provider reported a rate limit, quota or balance restriction.';
  if (/timeout|timed.out|aborted/i.test(text))
    return 'The operation timed out or was cancelled.';
  if (/changed on disk|conflict/i.test(text))
    return 'The configuration changed elsewhere. Refresh before saving again.';
  if (/\b400\b|unsupported|invalid.parameter/i.test(text))
    return 'The provider rejected the request format or parameters. Check the protocol and model configuration.';
  return 'Droid could not complete this operation. Check the connection, key and model configuration.';
}

async function verifyThroughDroid(
  daemon: DaemonApi,
  runtimeId: string,
  parentSignal: AbortSignal,
): Promise<ModelVerification> {
  parentSignal.throwIfAborted();
  const started = Date.now();
  const timeout = AbortSignal.timeout(45_000);
  const signal = AbortSignal.any([parentSignal, timeout]);
  const cwd = await mkdtemp(join(tmpdir(), 'droidvisx-model-check-'));
  let session: DaemonSessionHandle | undefined;
  let result: ModelVerification = {
    status: 'failed',
    message: 'Droid did not return a completed reply.',
    latencyMs: 0,
  };
  try {
    session = await daemon.sessions.create({
      cwd,
      modelId: runtimeId,
      title: 'Droid model verification',
      interactionMode: DroidInteractionMode.Auto,
      autonomyLevel: AutonomyLevel.Off,
      autoRejectPermissionRequests: true,
      disableBuiltinSkills: true,
      mcpServers: [],
      privacyLevel: 'private',
      permissionHandler: () => ToolConfirmationOutcome.Cancel,
      askUserHandler: () => ({ cancelled: true, answers: [] }),
    });
    signal.throwIfAborted();
    if (session.settings.modelId !== runtimeId) {
      throw new Error('Droid selected a different model.');
    }
    // A verification must not inherit a different Spec-mode model.
    // The public SDK does not expose a complete tool allowlist or hook
    // isolation. Permission requests are rejected and tool calls fail the test.
    await daemon.sessions.updateSettings(session.id, {
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    signal.throwIfAborted();
    for await (const event of session.stream(
      'Connection verification only. Do not use tools or inspect files. Reply with exactly OK.',
      { abortSignal: signal },
    )) {
      if (event.type === 'tool_call') {
        await session.interrupt();
        result = {
          status: 'failed',
          message: 'The model requested tools instead of a verification reply.',
          latencyMs: 0,
        };
        break;
      }
      if (event.type === 'error') {
        result = {
          status: 'failed',
          message: modelFailureMessage(new Error(event.message)),
          latencyMs: 0,
        };
      }
      if (event.type === 'result') {
        result =
          event.success && event.text.trim().length > 0
            ? {
                status: 'passed',
                message: 'Droid completed a real model request.',
                latencyMs: 0,
              }
            : {
                status: 'failed',
                message:
                  event.error === null
                    ? 'Droid did not complete the verification reply.'
                    : modelFailureMessage(new Error(event.error.message)),
                latencyMs: 0,
              };
      }
    }
  } catch (error) {
    result = {
      status: 'failed',
      message: signal.aborted
        ? 'Verification cancelled or timed out.'
        : modelFailureMessage(error),
      latencyMs: 0,
    };
  } finally {
    // Cleanup has a separate outcome from the completed model request. Keep
    // its warning visible without misreporting a working model as unavailable.
    if (session !== undefined) {
      try {
        await session.close();
        const archived = await daemon.sessions.archive(session.id);
        if (!archived.success) throw new Error('Droid did not confirm verification-session archival.');
      } catch {
        await session.detach().catch(() => undefined);
        result = {
          ...result,
          message: `${result.message} Droid did not confirm verification-session cleanup.`,
        };
      }
    }
    try {
      await rm(cwd, { recursive: true, force: true });
    } catch {
      result = {
        ...result,
        message: `${result.message} The verification temporary directory could not be removed.`,
      };
    }
  }
  return { ...result, latencyMs: Date.now() - started };
}
