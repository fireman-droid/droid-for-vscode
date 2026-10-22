import { MAX_BRIDGE_ID_LENGTH } from '../protocol/interactionProtocol';
import { isStrictRecord } from '../validation/strictValidation';

export function isScriptParentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Keep the CLI's explicit attribution; never infer parents from order or output. */
export function scriptParentFields(value: unknown): { readonly scriptParentId?: string } {
  if (!isStrictRecord(value)) return {};
  const parent = value.scriptParentId ?? (isStrictRecord(value.scriptExecution) ? value.scriptExecution.outerToolUseId : undefined);
  const ownId = value.toolUseId ?? value.id;
  return isScriptParentId(parent) && parent !== ownId ? { scriptParentId: parent } : {};
}
