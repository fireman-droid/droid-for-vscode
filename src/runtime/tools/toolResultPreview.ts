import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { relative, resolve } from 'node:path';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../shared/protocol/bounds';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { stripTerminalNoise } from '../../shared/transcript/toolOutput';
import {
  MAX_TOOL_RESULT_LINES,
  MAX_TOOL_RESULT_SOURCE_LENGTH,
  MAX_TOOL_RESULT_TEXT_UNITS,
  RESULT_TOOLS,
  unavailableResult,
  type ResultTool,
  type ToolResultPreview,
  type ToolResultSource,
} from '../../shared/transcript/toolResultPreview';

export type ResultSource = ToolResultSource | 'restricted' | 'untrusted';
const MAX_SOURCE_INPUT_LENGTH = 4_096;
const MAX_RESULT_SCAN_UNITS = MAX_TOOL_RESULT_TEXT_UNITS * 2;
const SENSITIVE_PATH =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.ssh|\.aws|\.azure|\.kube|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|pfx|p12|key))(?:\/|$)|(?:^|\/)(?:\.factory|\.cursor)\/(?:auth|settings|config)/iu;
const SENSITIVE_TEXT =
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY)|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|_authToken)\b["']?\s*[:=]\s*["']?[^\s"']{8,}|\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S+|[?&](?:token|key|secret)=[^\s&]+|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/iu;

export function isRestrictedToolContent(text: string): boolean {
  return SENSITIVE_TEXT.test(text) || /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text);
}

export function nativeResultTool(name: string): ResultTool | undefined {
  return RESULT_TOOLS.find((tool) => tool === name);
}

export function readResultSource(
  tool: ResultTool,
  input: unknown,
  workspace: string | undefined,
  callId: string,
): ResultSource {
  if (
    !workspace ||
    !isStrictRecord(input) ||
    !callId ||
    callId.length > MAX_BRIDGE_ID_LENGTH ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(callId)
  )
    return 'untrusted';
  const raw =
    tool === 'Read'
      ? (input.file_path ?? input.filePath)
      : tool === 'Grep'
        ? input.path
        : tool === 'Glob'
          ? (input.folder ?? input.path)
          : (input.directory_path ?? input.path);
  if (raw === undefined && tool === 'Read') return 'untrusted';
  if (
    raw !== undefined &&
    (typeof raw !== 'string' ||
      raw.length > MAX_SOURCE_INPUT_LENGTH ||
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(raw))
  )
    return 'untrusted';
  const path =
    relative(workspace, resolve(workspace, (raw as string | undefined) ?? '.')).replace(
      /\\/gu,
      '/',
    ) || '.';
  if (
    path === '..' ||
    path.startsWith('../') ||
    /^(?:\/|[A-Za-z]:)/u.test(path) ||
    path.length > MAX_TOOL_RESULT_SOURCE_LENGTH ||
    SENSITIVE_PATH.test(path)
  )
    return 'restricted';
  return { tool, path, callId };
}

export function extractResultPreview(
  content: unknown,
  source: ResultSource,
): ToolResultPreview {
  if (typeof source === 'string') return unavailableResult(source);
  let text = '';
  let lines = 1;
  let scanned = 0;
  let truncated = false;
  let unsupported = false;
  const append = (value: string): void => {
    const bounded = value.slice(0, Math.max(0, MAX_RESULT_SCAN_UNITS - scanned));
    scanned += bounded.length;
    const cleaned = stripTerminalNoise(bounded)
      .replace(/\r\n?/gu, '\n')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '');
    for (let index = 0; index < cleaned.length; index += 1) {
      if (text.length >= MAX_TOOL_RESULT_TEXT_UNITS) {
        truncated = true;
        return;
      }
      const char = cleaned[index]!;
      if (char === '\n') {
        if (lines >= MAX_TOOL_RESULT_LINES) {
          truncated = true;
          return;
        }
        lines += 1;
      }
      text += char;
    }
    truncated ||= bounded.length < value.length;
  };
  if (typeof content === 'string') append(content);
  else if (Array.isArray(content)) {
    for (let index = 0; index < content.length; index += 1) {
      if (index >= MAX_TOOL_RESULT_LINES) {
        truncated = true;
        break;
      }
      const block: unknown = content[index];
      if (
        !isStrictRecord(block) ||
        block.type !== 'text' ||
        typeof block.text !== 'string'
      ) {
        unsupported = true;
        break;
      }
      if (text.length > 0) append('\n');
      if (!truncated) append(block.text);
      if (truncated) break;
    }
  } else unsupported = true;
  if (unsupported) return unavailableResult('unsupported');
  if (SENSITIVE_TEXT.test(text)) return unavailableResult('restricted');
  if (text.trim().length === 0)
    return unavailableResult(truncated ? 'unsupported' : 'empty');
  // A truncated UTF-16 string must not end with an unmatched high surrogate.
  if (truncated && /[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
  return { availability: 'available', source, text, truncated };
}

export function createToolResultCollector(workspace?: string) {
  const sources = new Map<string, ResultSource>();
  return (event: DroidStreamEvent): ToolResultPreview | undefined => {
    if (event.type === 'tool_call') {
      const tool = nativeResultTool(event.name);
      if (
        tool &&
        (sources.has(event.toolUseId) || sources.size < MAX_TOOL_ACTIVITIES_PER_TURN)
      ) {
        sources.set(
          event.toolUseId,
          readResultSource(tool, event.input, workspace, event.toolUseId),
        );
      }
      return undefined;
    }
    if (event.type !== 'tool_result') return undefined;
    const source = sources.get(event.toolUseId);
    sources.delete(event.toolUseId);
    if (!nativeResultTool(event.toolName) || event.isError) return undefined;
    if (typeof source === 'object' && source.tool !== event.toolName)
      return unavailableResult('untrusted');
    return extractResultPreview(event.content, source ?? 'untrusted');
  };
}
