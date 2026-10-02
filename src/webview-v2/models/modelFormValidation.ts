import { isCustomModelBaseUrl, isSafeText, MAX_CUSTOM_MODEL_OUTPUT_TOKENS } from '../../shared/protocol/customModelsProtocol';
import { MAX_MODEL_ID_LENGTH } from '../../shared/protocol/bounds';
import type { ManagedModel } from '../../shared/protocol/modelManagerProtocol';

export function nameError(value: string, maxLength: number, label: string): string | undefined {
  if (!value.trim()) return `请填写${label}，不能只输入空格。`;
  if (!isSafeText(value.trim(), maxLength)) return `${label}最多 ${maxLength} 个字符，且不能包含控制字符。`;
  return undefined;
}

export function baseUrlError(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return '请填写服务方提供的 Base URL。';
  if (!isCustomModelBaseUrl(trimmed)) return '请使用完整的 HTTP(S) 地址，不含空格、账号密码、查询参数或 # 片段。';
  return undefined;
}

export function modelErrors(
  draft: { id: string; name: string; tokens: string },
  connectionId: string,
  model: ManagedModel | null,
  existingModels: readonly ManagedModel[],
): { id?: string; name?: string; tokens?: string } {
  const id = draft.id.trim();
  const name = draft.name.trim();
  const others = existingModels.filter((row) => row.rawIndex !== model?.rawIndex);
  let idError = nameError(id, MAX_MODEL_ID_LENGTH, 'Model ID');
  if (!idError && others.some((row) => row.connectionId === connectionId && row.model === id)) {
    idError = '此接口已有这个 Model ID，请编辑已有模型或填写其他 ID。';
  }
  const aliasError = name && !isSafeText(name, 160) ? '模型别名最多 160 个字符，且不能包含控制字符。' : undefined;
  const tokenValue = Number(draft.tokens);
  const tokensError = draft.tokens.trim() !== '' && (
    !Number.isSafeInteger(tokenValue) || tokenValue < 1 || tokenValue > MAX_CUSTOM_MODEL_OUTPUT_TOKENS
  ) ? `请输入 1–${MAX_CUSTOM_MODEL_OUTPUT_TOKENS.toLocaleString('en-US')} 之间的整数，或留空使用默认值。` : undefined;
  return { id: idError, name: aliasError, tokens: tokensError };
}
