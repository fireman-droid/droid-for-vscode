import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../shared/protocol/bounds';
import { isScriptParentId, scriptParentFields } from '../../shared/transcript/scriptActivity';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { defaultSessionsDirectory } from '../catalog/sessionFavorites';
import { readPersistedSessionMessages } from '../history/persistedSessionMessages';
import { parseOperationResult } from './operationResult';
import { createOperationDiffCollector, operationToolName } from './operationDiff';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import type { RuntimeEvent } from '../runtimeEvents';

/** Script child results may stream as receipts while JSONL retains the full result. */
export class ScriptEvidence {
  private readonly parents = new Map<string, string>();
  private readonly pending = new Map<string, string>();
  constructor(private readonly sessionId: string, private readonly workspace: string | undefined,
    private readonly readSaved = () => readPersistedSessionMessages(defaultSessionsDirectory(), sessionId)) {}

  observe(raw: Record<string, unknown>): void {
    const params = isStrictRecord(raw.params) ? raw.params : raw;
    if (params.sessionId !== undefined && params.sessionId !== this.sessionId) return;
    const event = isStrictRecord(params.notification) ? params.notification : params;
    const blocks = event.type === 'create_message' && isStrictRecord(event.message) && Array.isArray(event.message.content)
      ? event.message.content : event.type === 'tool_call' ? [event.toolUse] : [];
    for (const block of blocks) {
      if (!isStrictRecord(block) || !isScriptParentId(block.id)) continue;
      const { scriptParentId } = scriptParentFields(block);
      if (scriptParentId && this.parents.size < MAX_TOOL_ACTIVITIES_PER_TURN) this.parents.set(block.id, scriptParentId);
    }
  }

  fields(event: DroidStreamEvent) {
    const id = event.type === 'tool_call' ? event.toolUseId : event.type === 'tool_call_delta' ? event.toolUse.id : undefined;
    return { ...scriptParentFields({ scriptParentId: id ? this.parents.get(id) : undefined }), ...scriptParentFields(event) };
  }

  track(event: DroidStreamEvent, diff: OperationDiff | undefined): void {
    if (event.type !== 'tool_result' || !operationToolName(event.toolName)) return;
    if (diff?.status === 'ready' && diff.source === 'tool-result') this.pending.delete(event.toolUseId);
    else if (diff?.status === 'unavailable' && diff.reason === 'not-recorded' && this.pending.size < MAX_TOOL_ACTIVITIES_PER_TURN)
      this.pending.set(event.toolUseId, event.toolName);
  }

  async recover(event: DroidStreamEvent): Promise<RuntimeEvent[]> {
    if (!this.pending.size || !this.workspace || !(event.type === 'result' || event.type === 'tool_result' && event.toolName === 'Script')) return [];
    const ids = [...this.pending.keys()].filter(id => event.type === 'result' || this.parents.get(id) === event.toolUseId);
    if (!ids.length) return [];
    const saved = await this.readSaved();
    if (!saved) return [];
    const calls = new Map<string, Record<string, unknown>[]>();
    const results = new Map<string, Record<string, unknown>[]>();
    for (const message of saved.messages) for (const block of message.content) {
      if (!isStrictRecord(block)) continue;
      const id = block.type === 'tool_use' ? block.id : block.type === 'tool_result' ? block.toolUseId : undefined;
      if (typeof id !== 'string' || !ids.includes(id)) continue;
      const map = block.type === 'tool_use' ? calls : results;
      map.set(id, [...map.get(id) ?? [], block]);
    }
    const recovered: RuntimeEvent[] = [];
    for (const id of ids) {
      const call = calls.get(id), result = results.get(id);
      if (call?.length !== 1 || result?.length !== 1 || call[0]!.name !== this.pending.get(id) ||
        result[0]!.isError !== undefined && typeof result[0]!.isError !== 'boolean') continue;
      const toolName = this.pending.get(id)!;
      const operationDiff = parseOperationResult(operationToolName(toolName)!, call[0]!.input, result[0]!.content,
        this.workspace, id, this.sessionId, result[0]!.isError === true);
      if (operationDiff.status !== 'ready' || operationDiff.source !== 'tool-result') continue;
      recovered.push({ type: 'tool-result', toolName, toolUseId: id, action: toolName,
        isError: result[0]!.isError === true, operationDiff });
      this.pending.delete(id);
    }
    return recovered;
  }
}

/** Shared live path: process and daemon sessions retain the same attribution/evidence. */
export async function* withScriptEvidence(
  stream: AsyncIterable<DroidStreamEvent>,
  session: { readonly id: string; onNotification?: (listener: (notification: Record<string, unknown>) => void) => () => void },
  workspace: string | undefined,
): AsyncGenerator<{ event: DroidStreamEvent; operation: OperationDiff | undefined }> {
  const evidence = new ScriptEvidence(session.id, workspace);
  const collect = createOperationDiffCollector(workspace, session.id);
  const stop = session.onNotification?.(notification => evidence.observe(notification));
  try {
    for await (const event of stream) {
      const operation = collect(event);
      evidence.track(event, operation);
      for (const recovered of await evidence.recover(event)) {
        if (recovered.type === 'tool-result') yield { event: { type: 'tool_result', toolUseId: recovered.toolUseId,
          toolName: recovered.toolName, isError: recovered.isError, content: '' }, operation: recovered.operationDiff };
      }
      yield { event: { ...event, ...evidence.fields(event) }, operation };
    }
  } finally { stop?.(); }
}
