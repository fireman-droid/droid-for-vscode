import { promises as fs } from 'node:fs';
import path from 'node:path';
import { repairParentChainCorruption, type SessionMessage } from '@factory/droid-sdk';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { isSafeSessionIdentifier } from '../catalog/SessionCatalog';

// Above the observed 69 MB / 6,420-message transcript. Larger or unfamiliar
// files retain the daemon pagination path instead of silently losing history.
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface PersistedSessionMessages {
  readonly messages: SessionMessage[];
  readonly bytes: number;
}

/** Read the same version-2 JSONL consumed by CLI get_session_messages once.
 * The CLI otherwise reads and parses the entire file again for each 100 rows.
 * A fixed initial byte boundary keeps a growing log from extending this read.
 */
export async function readPersistedSessionMessages(
  sessionsDirectory: string,
  sessionId: string,
): Promise<PersistedSessionMessages | null> {
  if (!isSafeSessionIdentifier(sessionId) || /[\\/]/.test(sessionId)) return null;
  try {
    const file = await locateSessionFile(sessionsDirectory, sessionId);
    if (file === null) return null;
    const handle = await fs.open(file, 'r');
    try {
      const initial = await handle.stat();
      if (!initial.isFile() || initial.size === 0 || initial.size > MAX_SNAPSHOT_BYTES) return null;
      const messages: SessionMessage[] = [];
      let headerSeen = false;
      const line = (buffer: Buffer): void => {
        const text = buffer.toString('utf8').trim();
        if (text.length === 0) return;
        const event: unknown = JSON.parse(text);
        if (!isStrictRecord(event)) throw new Error('Invalid session log record');
        if (!headerSeen) {
          if (event.type !== 'session_start' || event.id !== sessionId || event.version !== 2)
            throw new Error('Unsupported session log header');
          headerSeen = true;
        } else if (event.type === 'message') messages.push(convertPersistedMessage(event));
        else if (event.type === 'session_start') throw new Error('Repeated session log header');
      };
      let position = 0;
      let fragments: Buffer[] = [];
      while (position < initial.size) {
        const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, initial.size - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) return null;
        position += bytesRead;
        let start = 0;
        for (let end = buffer.indexOf(10); end !== -1 && end < bytesRead; end = buffer.indexOf(10, start)) {
          const part = buffer.subarray(start, end);
          if (fragments.length > 0) { fragments.push(part); line(Buffer.concat(fragments)); fragments = []; }
          else line(part);
          start = end + 1;
        }
        if (start < bytesRead) fragments.push(buffer.subarray(start, bytesRead));
      }
      // JSONL may legally end without a newline. A partially written record
      // rejects the snapshot, so the daemon decides what is currently readable.
      if (fragments.length > 0) line(Buffer.concat(fragments));
      if (!headerSeen) return null;
      const final = await handle.stat();
      const current = await fs.stat(file);
      if (final.size < initial.size || current.ino !== initial.ino || current.dev !== initial.dev ||
        (final.size === initial.size && final.mtimeMs !== initial.mtimeMs)) return null;
      // CLI: repair parent references, replace duplicate IDs in insertion order,
      // then return newest first. Keep its tie order before the loader's sort.
      const unique = new Map<string, SessionMessage>();
      for (const message of repairParentChainCorruption(messages)) unique.set(message.id, message);
      return { messages: [...unique.values()].reverse(), bytes: initial.size };
    } finally { await handle.close(); }
  } catch {
    // Private persistence format is an optional fast path. The caller preserves
    // public daemon pagination, followed by the existing process fallback.
    return null;
  }
}

async function locateSessionFile(directory: string, sessionId: string): Promise<string | null> {
  const exists = async (file: string) => fs.stat(file).then(stats => stats.isFile(), () => false);
  for (const parent of [directory, path.join(directory, 'btw')]) {
    const file = path.join(parent, `${sessionId}.jsonl`);
    if (await exists(file)) return file;
  }
  // Same global lookup as the CLI, including worktrees / delegated sessions
  // whose persisted cwd differs from the currently open workspace.
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('-')) continue;
    const file = path.join(directory, entry.name, `${sessionId}.jsonl`);
    if (await exists(file)) return file;
  }
  return null;
}

function convertPersistedMessage(event: Record<string, unknown>): SessionMessage {
  const message = event.message;
  const time = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
  if (typeof event.id !== 'string' || !event.id || !Number.isFinite(time) || !isStrictRecord(message) ||
    typeof message.role !== 'string') throw new Error('Invalid persisted session message');
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }]
    : Array.isArray(message.content) ? message.content.map(convertContent) : null;
  if (content === null) throw new Error('Invalid persisted message content');
  const role = message.role === 'user' && content.some(block => block.type === 'tool_result') ? 'tool' : message.role;
  return { id: event.id, parentId: event.parentId, createdAt: time, updatedAt: time,
    ...message, role, content } as SessionMessage;
}

/** CLI's persisted Anthropic-style fields → public SDK content blocks. */
function convertContent(value: unknown): Record<string, unknown> {
  if (!isStrictRecord(value) || typeof value.type !== 'string') throw new Error('Invalid persisted content block');
  const id = value.id === undefined ? {} : { id: value.id };
  switch (value.type) {
    case 'text': return { type: 'text', text: value.text, ...id };
    case 'image': {
      if (!isStrictRecord(value.source)) throw new Error('Invalid image source');
      return { type: 'image', source: { type: 'base64', data: value.source.data, mediaType: value.source.media_type }, ...id };
    }
    case 'thinking': return { type: 'thinking', thinking: value.thinking, signature: value.signature,
      ...(value.signatureProvider ? { signatureProvider: value.signatureProvider } : {}),
      ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }), ...id };
    case 'redacted_thinking': return { type: 'redacted_thinking', data: value.data, ...id };
    case 'tool_use': {
      const script = value.script_execution;
      if (script !== undefined && !isStrictRecord(script)) throw new Error('Invalid script execution');
      return { type: 'tool_use', id: value.id, input: value.input, name: value.name === 'MultiEdit' ? 'Edit' : value.name,
        ...(value.thought_signature ? { thoughtSignature: value.thought_signature } : {}),
        ...(value.namespace ? { namespace: value.namespace } : {}),
        ...(isStrictRecord(script) ? { scriptExecution: { runId: script.run_id, outerToolUseId: script.outer_tool_use_id } } : {}) };
    }
    case 'tool_result': return { type: 'tool_result', toolUseId: value.tool_use_id, ...id,
      ...(value.is_error === undefined ? {} : { isError: value.is_error }),
      ...(value.content === undefined ? {} : { content: typeof value.content === 'string' ? value.content
        : Array.isArray(value.content) ? value.content.map(convertResultContent) : invalidResult() }) };
    case 'document': {
      if (!isStrictRecord(value.source)) throw new Error('Invalid document source');
      const source = value.source;
      return { type: 'document', source: source.media_type === 'application/pdf'
        ? { type: 'base64', mediaType: 'application/pdf', data: source.data ?? '', parsedData: source.parsed_data,
          name: source.name, path: source.path }
        : { type: 'text', mediaType: 'text/plain', data: source.data ?? '', name: source.name, mime: source.mime } };
    }
    default: return value;
  }
}

function convertResultContent(value: unknown): Record<string, unknown> {
  if (!isStrictRecord(value)) return invalidResult();
  return value.type === 'text' || value.type === 'image' ? convertContent(value) : value;
}

function invalidResult(): never { throw new Error('Invalid tool result content'); }
