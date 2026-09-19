import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  DroidLogEvent,
  DroidMetricEvent,
  DroidObservability,
} from '@factory/droid-sdk/node';
import type * as vscode from 'vscode';

import type {
  RuntimeDiagnosticAttribute,
  RuntimeDiagnosticEvent,
  RuntimeDiagnosticSink,
} from '../../runtime/runtimeDiagnostics';
import {
  isCredentialKey,
  scrubCredentialAssignments,
} from '../../shared/validation/presentationSafety';

/**
 * Full-fidelity local diagnostics (user decision, 2026-08-11): this is a
 * personal local tool and the logs exist so an AI can debug against real
 * content. Prompts, tool inputs/outputs, commands, paths, session/turn/
 * tool IDs, raw errors, and stack traces are all persisted as-is. The
 * only filtering is credential scrubbing (API keys, tokens, auth
 * headers) — that is secret hygiene, not privacy redaction.
 */
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_NAME_LENGTH = 128;
const MAX_DETAIL_LENGTH = 16_384;
const MAX_ATTRIBUTE_COUNT = 32;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;
const MAX_ATTRIBUTE_STRING_LENGTH = 8_192;
const MAX_ATTRIBUTE_NESTING_DEPTH = 8;
const MAX_ATTRIBUTE_PROJECTION_NODES = 256;
const MAX_ATTRIBUTE_PROJECTION_OUTPUT_UNITS = 8_192;
const NAME_PATTERN = /^[a-zA-Z0-9_.:-]+$/u;
const LOG_FILE_PATTERN = /^droidvisx-\d{8}\.jsonl$/u;

interface DiagnosticsFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  appendFile(
    path: string,
    data: string,
    options: { encoding: 'utf8'; mode: number },
  ): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}

interface LocalDiagnosticsOptions {
  /** Log directory (globalStorage/logs); stable across Cursor windows. */
  readonly directory: string;
  readonly output: Pick<vscode.OutputChannel, 'appendLine' | 'show' | 'dispose'>;
  /** Workspace path stamped on every record. */
  readonly workspace?: () => string | null;
  readonly now?: () => Date;
  readonly maxTotalBytes?: number;
  readonly fileSystem?: DiagnosticsFileSystem;
}

interface PersistedDiagnosticRecord {
  readonly timestamp: string;
  readonly sequence: number;
  /** Activation instance id; new per extension activation. */
  readonly act: string;
  readonly source: 'host' | 'sdk';
  readonly level: RuntimeDiagnosticEvent['level'];
  readonly name: string;
  readonly workspace?: string;
  /** Bridge turnId of the active turn scope, if any. */
  readonly turn?: string;
  readonly attributes?: Readonly<Record<string, RuntimeDiagnosticAttribute>>;
  readonly detail?: string;
}

const nodeFileSystem: DiagnosticsFileSystem = {
  mkdir,
  appendFile,
  stat,
  readdir,
  unlink,
};

export class LocalDiagnostics implements RuntimeDiagnosticSink {
  readonly directory: string;
  readonly act: string;
  readonly observability: DroidObservability;

  private readonly output: LocalDiagnosticsOptions['output'];
  private readonly workspace: () => string | null;
  private readonly now: () => Date;
  private readonly maxTotalBytes: number;
  private readonly fileSystem: DiagnosticsFileSystem;
  private writeQueue: Promise<void> = Promise.resolve();
  private sequence = 0;
  private disposed = false;
  private currentTurn: string | null = null;
  /** Sizes of known log files; lazily seeded from disk on first write. */
  private knownSizes: Map<string, number> | null = null;

  constructor(options: LocalDiagnosticsOptions) {
    this.directory = options.directory;
    this.output = options.output;
    this.workspace = options.workspace ?? (() => null);
    this.now = options.now ?? (() => new Date());
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.act = randomBytes(3).toString('hex');
    this.observability = {
      logger: {
        log: (event) => this.recordSdkLog(event),
      },
      metrics: {
        record: (event) => this.recordSdkMetric(event),
      },
    };
  }

  /** Path of the log file the next record would be appended to. */
  get filePath(): string {
    return join(this.directory, currentFileName(this.now()));
  }

  record(event: RuntimeDiagnosticEvent): void {
    this.enqueue('host', event);
  }

  beginTurnScope(turnId: string): void {
    this.currentTurn = turnId;
  }

  endTurnScope(): void {
    this.currentTurn = null;
  }

  show(): void {
    try {
      this.output.show(true);
    } catch {
      // Diagnostics must never interfere with extension commands.
    }
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.output.dispose();
    } catch {
      // Diagnostics teardown must never interfere with extension disposal.
    }
  }

  private recordSdkLog(event: DroidLogEvent): void {
    this.enqueueRaw('sdk', {
      level: event.level,
      name: projectSdkLogName(event),
      attributes: event.attributes,
      detail: formatSdkLogDetail(event),
    });
  }

  private recordSdkMetric(event: DroidMetricEvent): void {
    this.enqueue('sdk', {
      level: 'debug',
      name: 'sdk.metric',
      attributes: {
        metric: event.name,
        kind: event.kind,
        unit: event.unit,
        value: Number.isFinite(event.value) ? event.value : 0,
        ...event.attributes,
      },
    });
  }

  private enqueue(
    source: PersistedDiagnosticRecord['source'],
    event: RuntimeDiagnosticEvent,
  ): void {
    this.enqueueRaw(source, event);
  }

  private enqueueRaw(
    source: PersistedDiagnosticRecord['source'],
    event: {
      readonly level: RuntimeDiagnosticEvent['level'];
      readonly name: string;
      readonly attributes?: Readonly<Record<string, unknown>>;
      readonly detail?: string;
    },
  ): void {
    if (this.disposed) {
      return;
    }
    const workspace = safeWorkspace(this.workspace);
    const record: PersistedDiagnosticRecord = {
      timestamp: this.now().toISOString(),
      sequence: this.sequence,
      act: this.act,
      source,
      level: event.level,
      name: boundedName(event.name, `${source}.event`),
      ...(workspace === null ? {} : { workspace }),
      ...(this.currentTurn === null ? {} : { turn: this.currentTurn }),
      ...(event.attributes === undefined
        ? {}
        : { attributes: projectAttributes(event.attributes) }),
      ...(event.detail === undefined ? {} : { detail: sanitizeDetail(event.detail) }),
    };
    this.sequence += 1;

    let line: string;
    try {
      line = `${JSON.stringify(record)}\n`;
    } catch {
      return;
    }
    try {
      this.output.appendLine(formatOutputRecord(record));
    } catch {
      // Keep file diagnostics working when the Output Channel is unavailable.
    }
    const fileName = currentFileName(this.now());
    this.writeQueue = this.writeQueue
      .then(() => this.writeLine(fileName, line))
      .catch(() => {
        // Sink failures are contained and later records can still be queued.
      });
  }

  private async writeLine(fileName: string, line: string): Promise<void> {
    await this.fileSystem.mkdir(this.directory, { recursive: true });
    const sizes = await this.loadKnownSizes();
    const lineBytes = Buffer.byteLength(line, 'utf8');
    await this.fileSystem.appendFile(join(this.directory, fileName), line, {
      encoding: 'utf8',
      mode: 0o600,
    });
    sizes.set(fileName, (sizes.get(fileName) ?? 0) + lineBytes);
    await this.enforceTotalBudget(sizes, fileName);
  }

  private async loadKnownSizes(): Promise<Map<string, number>> {
    if (this.knownSizes !== null) {
      return this.knownSizes;
    }
    const sizes = new Map<string, number>();
    try {
      const entries = await this.fileSystem.readdir(this.directory);
      for (const entry of entries) {
        if (!LOG_FILE_PATTERN.test(entry)) {
          continue;
        }
        try {
          sizes.set(
            entry,
            (await this.fileSystem.stat(join(this.directory, entry))).size,
          );
        } catch {
          // A file that cannot be measured is excluded from the budget.
        }
      }
    } catch {
      // An unreadable directory starts with an empty budget.
    }
    this.knownSizes = sizes;
    return sizes;
  }

  /**
   * Deletes whole oldest-day files until the total stays under the
   * budget. The current day's file is never deleted, so a single very
   * heavy day may overshoot the cap by design.
   */
  private async enforceTotalBudget(
    sizes: Map<string, number>,
    currentFile: string,
  ): Promise<void> {
    let total = 0;
    for (const size of sizes.values()) {
      total += size;
    }
    if (total <= this.maxTotalBytes) {
      return;
    }
    const deletable = [...sizes.keys()].filter((name) => name !== currentFile).sort();
    for (const name of deletable) {
      if (total <= this.maxTotalBytes) {
        return;
      }
      try {
        await this.fileSystem.unlink(join(this.directory, name));
        total -= sizes.get(name) ?? 0;
        sizes.delete(name);
      } catch {
        // Undeletable backups stay; the budget is best-effort.
      }
    }
  }
}

/** Daily log file name derived from the UTC date. */
function currentFileName(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `droidvisx-${date}.jsonl`;
}

function safeWorkspace(workspace: () => string | null): string | null {
  try {
    return workspace();
  } catch {
    return null;
  }
}

function projectAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, RuntimeDiagnosticAttribute>> | undefined {
  if (attributes === undefined) {
    return undefined;
  }
  const projected: Record<string, RuntimeDiagnosticAttribute> = {};
  const context: AttributeProjectionContext = {
    remainingNodes: MAX_ATTRIBUTE_PROJECTION_NODES,
    remainingOutputUnits: MAX_ATTRIBUTE_PROJECTION_OUTPUT_UNITS,
  };
  let rawKeys: string[];
  try {
    rawKeys = Object.keys(attributes);
  } catch {
    return undefined;
  }
  for (const rawKey of rawKeys) {
    if (
      Object.keys(projected).length >= MAX_ATTRIBUTE_COUNT ||
      context.remainingNodes <= 0 ||
      context.remainingOutputUnits <= 0
    ) {
      break;
    }
    const key = scrubCredentials(rawKey).slice(0, MAX_ATTRIBUTE_KEY_LENGTH);
    if (key.length === 0 || key.length > context.remainingOutputUnits) {
      continue;
    }
    if (isCredentialKey(rawKey)) {
      if (!consumeOutput(context, key.length + '[REDACTED]'.length)) {
        break;
      }
      projected[key] = '[REDACTED]';
      continue;
    }
    if (!consumeNode(context)) {
      break;
    }
    let rawValue: unknown;
    try {
      rawValue = attributes[rawKey];
    } catch {
      continue;
    }
    const outputBefore = context.remainingOutputUnits;
    if (!consumeOutput(context, key.length)) {
      break;
    }
    if (typeof rawValue === 'string') {
      const sanitized = scrubCredentials(rawValue).slice(
        0,
        Math.min(MAX_ATTRIBUTE_STRING_LENGTH, context.remainingOutputUnits),
      );
      if (!consumeOutput(context, sanitized.length)) {
        context.remainingOutputUnits = outputBefore;
        break;
      }
      projected[key] = sanitized;
    } else if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      if (!consumeSerializedPrimitive(context, 0)) {
        context.remainingOutputUnits = outputBefore;
        break;
      }
      projected[key] = 0;
    } else if (
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean' ||
      rawValue === null
    ) {
      if (!consumeSerializedPrimitive(context, rawValue)) {
        context.remainingOutputUnits = outputBefore;
        break;
      }
      projected[key] = rawValue;
    } else if (rawValue !== undefined) {
      const sanitized = sanitizeNestedAttribute(
        rawValue,
        0,
        new WeakSet<object>(),
        context,
      );
      if (sanitized !== OMIT_ATTRIBUTE_VALUE) {
        let serialized: string;
        try {
          serialized = JSON.stringify(sanitized);
        } catch {
          context.remainingOutputUnits = outputBefore;
          continue;
        }
        if (serialized.length <= MAX_ATTRIBUTE_STRING_LENGTH) {
          projected[key] = serialized;
          continue;
        }
      }
      context.remainingOutputUnits = outputBefore;
    } else {
      context.remainingOutputUnits = outputBefore;
    }
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

const OMIT_ATTRIBUTE_VALUE = Symbol('omit-diagnostic-attribute-value');
type SanitizedNestedAttribute =
  | string
  | number
  | boolean
  | null
  | SanitizedNestedAttribute[]
  | { [key: string]: SanitizedNestedAttribute };

interface AttributeProjectionContext {
  remainingNodes: number;
  remainingOutputUnits: number;
}

function sanitizeNestedAttribute(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  context: AttributeProjectionContext,
): SanitizedNestedAttribute | typeof OMIT_ATTRIBUTE_VALUE {
  if (typeof value === 'string') {
    return projectNestedString(
      scrubCredentials(value).slice(0, MAX_ATTRIBUTE_STRING_LENGTH),
      context,
    );
  }
  if (typeof value === 'number') {
    const sanitized = Number.isFinite(value) ? value : 0;
    return consumeSerializedPrimitive(context, sanitized)
      ? sanitized
      : OMIT_ATTRIBUTE_VALUE;
  }
  if (typeof value === 'boolean' || value === null) {
    return consumeSerializedPrimitive(context, value) ? value : OMIT_ATTRIBUTE_VALUE;
  }
  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value !== 'object' ||
    depth >= MAX_ATTRIBUTE_NESTING_DEPTH
  ) {
    return OMIT_ATTRIBUTE_VALUE;
  }

  try {
    if (ancestors.has(value)) {
      return OMIT_ATTRIBUTE_VALUE;
    }
    ancestors.add(value);
  } catch {
    return OMIT_ATTRIBUTE_VALUE;
  }
  try {
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      return OMIT_ATTRIBUTE_VALUE;
    }
    if (isArray) {
      const arrayValue = value as readonly unknown[];
      if (!consumeOutput(context, 2)) {
        return OMIT_ATTRIBUTE_VALUE;
      }
      const projected: SanitizedNestedAttribute[] = [];
      let length: number;
      if (!consumeNode(context)) {
        return projected;
      }
      try {
        length = arrayValue.length;
      } catch {
        return projected;
      }
      const count =
        typeof length === 'number' && Number.isFinite(length)
          ? Math.min(Math.max(Math.floor(length), 0), MAX_ATTRIBUTE_COUNT)
          : 0;
      for (let index = 0; index < count; index += 1) {
        if (!consumeNode(context)) {
          break;
        }
        const outputBefore = context.remainingOutputUnits;
        if (index > 0 && !consumeOutput(context, 1)) {
          break;
        }
        let nestedValue: unknown;
        try {
          nestedValue = arrayValue[index];
        } catch {
          if (consumeOutput(context, 4)) {
            projected.push(null);
          } else {
            context.remainingOutputUnits = outputBefore;
          }
          continue;
        }
        const sanitized = sanitizeNestedAttribute(
          nestedValue,
          depth + 1,
          ancestors,
          context,
        );
        if (sanitized !== OMIT_ATTRIBUTE_VALUE) {
          projected.push(sanitized);
          continue;
        }
        context.remainingOutputUnits = outputBefore;
        if ((index === 0 || consumeOutput(context, 1)) && consumeOutput(context, 4)) {
          projected.push(null);
        } else {
          context.remainingOutputUnits = outputBefore;
          break;
        }
      }
      return projected;
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return OMIT_ATTRIBUTE_VALUE;
    }
    if (prototype !== Object.prototype) {
      return OMIT_ATTRIBUTE_VALUE;
    }
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return OMIT_ATTRIBUTE_VALUE;
    }
    if (!consumeOutput(context, 2)) {
      return OMIT_ATTRIBUTE_VALUE;
    }
    const projected: Record<string, SanitizedNestedAttribute> = {};
    for (const rawKey of keys.slice(0, MAX_ATTRIBUTE_COUNT)) {
      const key = scrubCredentials(rawKey).slice(0, MAX_ATTRIBUTE_KEY_LENGTH);
      if (key.length === 0 || Object.hasOwn(projected, key)) {
        continue;
      }
      let serializedKey: string;
      try {
        serializedKey = JSON.stringify(key);
      } catch {
        continue;
      }
      const outputBefore = context.remainingOutputUnits;
      const propertyPrefixLength =
        (Object.keys(projected).length === 0 ? 0 : 1) + serializedKey.length + 1;
      if (!consumeOutput(context, propertyPrefixLength)) {
        break;
      }
      if (isCredentialKey(rawKey)) {
        if (!consumeOutput(context, '"[REDACTED]"'.length)) {
          context.remainingOutputUnits = outputBefore;
          break;
        }
        projected[key] = '[REDACTED]';
        continue;
      }
      if (!consumeNode(context)) {
        context.remainingOutputUnits = outputBefore;
        break;
      }
      let nestedValue: unknown;
      try {
        nestedValue = (value as Record<string, unknown>)[rawKey];
      } catch {
        context.remainingOutputUnits = outputBefore;
        continue;
      }
      const sanitized = sanitizeNestedAttribute(
        nestedValue,
        depth + 1,
        ancestors,
        context,
      );
      if (sanitized !== OMIT_ATTRIBUTE_VALUE) {
        projected[key] = sanitized;
      } else {
        context.remainingOutputUnits = outputBefore;
      }
    }
    return projected;
  } finally {
    try {
      ancestors.delete(value);
    } catch {
      // A failed cleanup cannot make diagnostics escape the trust boundary.
    }
  }
}

function consumeNode(context: AttributeProjectionContext): boolean {
  if (context.remainingNodes <= 0) {
    return false;
  }
  context.remainingNodes -= 1;
  return true;
}

function consumeOutput(context: AttributeProjectionContext, units: number): boolean {
  if (units > context.remainingOutputUnits) {
    return false;
  }
  context.remainingOutputUnits -= units;
  return true;
}

function consumeSerializedPrimitive(
  context: AttributeProjectionContext,
  value: number | boolean | null,
): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  return consumeOutput(context, serialized.length);
}

function projectNestedString(
  value: string,
  context: AttributeProjectionContext,
): string | typeof OMIT_ATTRIBUTE_VALUE {
  let low = 0;
  let high = Math.min(value.length, MAX_ATTRIBUTE_STRING_LENGTH);
  let projected: string | typeof OMIT_ATTRIBUTE_VALUE = OMIT_ATTRIBUTE_VALUE;
  let projectedLength = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = value.slice(0, middle);
    let serialized: string;
    try {
      serialized = JSON.stringify(candidate);
    } catch {
      return OMIT_ATTRIBUTE_VALUE;
    }
    if (serialized.length <= context.remainingOutputUnits) {
      projected = candidate;
      projectedLength = serialized.length;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (projected === OMIT_ATTRIBUTE_VALUE || !consumeOutput(context, projectedLength)) {
    return OMIT_ATTRIBUTE_VALUE;
  }
  return projected;
}

function projectSdkLogName(event: DroidLogEvent): string {
  switch (event.message) {
    case 'Transport error':
      return 'sdk.transport.error';
    case '[DroidClient] [daemon -> droid] sending request':
      return 'sdk.request.sent';
    case '[DroidClient] Failed to handle message':
      return 'sdk.message.invalid';
    case 'Invalid response format':
      return 'sdk.response.invalid';
    case '[droid process] Spawning':
      return 'sdk.process.spawning';
    case '[droid process] stderr':
      return 'sdk.process.stderr';
    case '[droid process] non-JSON output':
      return 'sdk.process.non_json_output';
    case '[DroidClient] Handling permission request':
      return 'sdk.permission.started';
    case '[DroidClient] Permission handler resolved':
      return 'sdk.permission.finished';
    case '[DroidClient] Handling ask-user request':
      return 'sdk.ask_user.started';
    case '[DroidClient] Ask-user handler resolved':
      return 'sdk.ask_user.finished';
    default:
      return boundedName(event.name, 'sdk.log');
  }
}

/** Full-fidelity SDK log payload: raw message plus error and stack. */
function formatSdkLogDetail(event: DroidLogEvent): string | undefined {
  const parts: string[] = [];
  if (typeof event.message === 'string' && event.message.length > 0) {
    parts.push(event.message);
  }
  const error = (
    event as {
      error?: { name?: string; message?: string; stack?: string };
    }
  ).error;
  if (error !== undefined && error !== null) {
    const label = [error.name, error.message]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .join(': ');
    if (label.length > 0) {
      parts.push(label);
    }
    if (typeof error.stack === 'string' && error.stack.length > 0) {
      parts.push(error.stack);
    }
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}

function boundedName(value: string, fallback: string): string {
  const bounded = value.slice(0, MAX_NAME_LENGTH);
  return bounded.length > 0 && NAME_PATTERN.test(bounded) ? bounded : fallback;
}

/**
 * Secret hygiene: strips credential-shaped values from free text. This
 * is the only filtering applied to the full-fidelity log.
 */
// Token-format patterns run first so `Authorization: Bearer <token>`
// is consumed whole before the assignment pattern sees it.
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/gu,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
];

export function scrubCredentials(text: string): string {
  let scrubbed = text;
  for (const pattern of TOKEN_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubCredentialAssignments(scrubbed);
}

function sanitizeDetail(detail: string): string {
  // Keep newlines and tabs (stacks, commands); JSON escaping keeps the
  // record single-line. Strip only the remaining control characters.
  // eslint-disable-next-line no-control-regex
  return scrubCredentials(detail)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ')
    .slice(0, MAX_DETAIL_LENGTH);
}

function formatOutputRecord(record: PersistedDiagnosticRecord): string {
  let attributes = '';
  if (record.attributes !== undefined) {
    try {
      attributes = ` ${JSON.stringify(record.attributes)}`;
    } catch {
      // Keep the remaining bounded record available in the Output Channel.
    }
  }
  const turn = record.turn === undefined ? '' : ` turn=${record.turn}`;
  const detail = record.detail === undefined ? '' : ` | ${record.detail}`;
  return `[${record.timestamp}] [${record.level}] ${record.source}:${record.name}${turn}${attributes}${detail}`;
}
