import { fileURLToPath } from 'node:url';
import { resultPreviewPolicy, toolPresentation } from '../../shared/transcript/toolCatalog';
import { isToolResultSummary, type ToolResultSummary } from '../../shared/transcript/toolResultSummary';
import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { relative, resolve } from 'node:path';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { MAX_TOOL_ACTIVITIES_PER_TURN, MAX_TOOL_NAME_LENGTH } from '../../shared/protocol/bounds';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { stripTerminalNoise } from '../../shared/transcript/toolOutput';
import {
  MAX_TOOL_RESULT_LINES,
  MAX_TOOL_RESULT_SOURCE_LENGTH,
  MAX_TOOL_RESULT_TEXT_UNITS,
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

export function previewResultTool(name: string): ResultTool | undefined {
  return resultPreviewPolicy(name) === 'none' ? undefined : name;
}

export function readGitHubResultPath(input: Record<string, unknown>): string | undefined {
  const { owner, repo, path } = input;
  if (typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string' ||
    owner.length > MAX_TOOL_RESULT_SOURCE_LENGTH || repo.length > MAX_TOOL_RESULT_SOURCE_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repo) ||
    repo === '.' || repo === '..' || path.length > MAX_TOOL_RESULT_SOURCE_LENGTH ||
    /[\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(path)) return undefined;
  const repositoryPath = path.replace(/^\/+|\/+$/gu, '');
  if (repositoryPath.split('/').some((part) => part === '.' || part === '..')) return undefined;
  const source = `${owner}/${repo}${repositoryPath ? `/${repositoryPath}` : ''}`;
  return source.length <= MAX_TOOL_RESULT_SOURCE_LENGTH ? source : undefined;
}

export function readResultSource(
  tool: ResultTool,
  input: unknown,
  workspace: string | undefined,
  callId: string,
): ResultSource {
  if (
    !isStrictRecord(input) || !tool || tool.length > MAX_TOOL_NAME_LENGTH ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(tool) ||
    !callId ||
    callId.length > MAX_BRIDGE_ID_LENGTH ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(callId)
  )
    return 'untrusted';
  const policy = resultPreviewPolicy(tool);
  const target = toolPresentation(tool)?.target;
  if (policy === 'web') {
    if (typeof input.query !== 'string' || !input.query.trim() ||
      input.query.length > MAX_SOURCE_INPUT_LENGTH) return 'untrusted';
    return isRestrictedToolContent(input.query) ? 'restricted' : { tool, path: 'Web search', callId };
  }
  if (policy === 'github') {
    const path = readGitHubResultPath(input);
    if (path === undefined) return 'untrusted';
    return SENSITIVE_PATH.test(path) ? 'restricted' : { tool, path, callId };
  }
  let raw: unknown;
  if (policy === 'workspace') {
    raw = target === 'file' ? (input.file_path ?? input.filePath ?? input.path)
      : target === 'search' ? input.path
      : target === 'glob' ? (input.folder ?? input.path)
      : (input.directory_path ?? input.path);
    if (raw === undefined && target === 'file') return 'untrusted';
  } else {
    raw = input.file_path ?? input.filePath ?? input.path ?? input.directory_path ?? input.folder;
    if (typeof input.uri === 'string' && input.uri.startsWith('file:')) {
      try { raw = fileURLToPath(input.uri); } catch { return 'untrusted'; }
    } else if (policy === 'diagnostics' && input.uri !== undefined) return 'untrusted';
    // Remote and argument-free tools have an identified call, but no local file source.
    if (raw === undefined && policy !== 'diagnostics') return { tool, path: 'Tool result', callId };
  }
  if (!workspace) return 'untrusted';
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
  const summary = resultPreviewPolicy(source.tool) === 'diagnostics'
    ? diagnosticSummary(content) : undefined;
  return { availability: 'available', source, text, truncated,
    ...(summary === undefined ? {} : { summary }) };
}

/** Parse complete bounded tool output, never a partial or model-written status. */
function diagnosticSummary(content: unknown): ToolResultSummary | undefined {
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 &&
    isStrictRecord(content[0]) && content[0].type === 'text' && typeof content[0].text === 'string'
    ? content[0].text : undefined;
  if (text === undefined || text.length > MAX_RESULT_SCAN_UNITS) return undefined;
  let result: unknown;
  try { result = JSON.parse(text); } catch { return undefined; }
  if (!isStrictRecord(result) || !Array.isArray(result.diagnostics)) return undefined;
  const summary = { kind: 'diagnostics', totalCount: result.totalCount, filteredCount: result.filteredCount };
  return isToolResultSummary(summary) && result.diagnostics.length === summary.filteredCount ? summary : undefined;
}

export function createToolResultCollector(workspace?: string) {
  const sources = new Map<string, { toolName: string; source: ResultSource }>();
  return (event: DroidStreamEvent): ToolResultPreview | undefined => {
    if (event.type === 'tool_call') {
      const tool = previewResultTool(event.name);
      if (tool && (sources.has(event.toolUseId) || sources.size < MAX_TOOL_ACTIVITIES_PER_TURN)) {
        sources.set(event.toolUseId, {
          toolName: event.name,
          source: readResultSource(tool, event.input, workspace, event.toolUseId),
        });
      }
      return undefined;
    }
    if (event.type !== 'tool_result') return undefined;
    const call = sources.get(event.toolUseId);
    sources.delete(event.toolUseId);
    if (!previewResultTool(event.toolName) || event.isError) return undefined;
    if (call?.toolName !== event.toolName) return unavailableResult('untrusted');
    return extractResultPreview(event.content, call.source);
  };
}
