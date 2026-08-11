import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
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
} from '../runtime/runtimeDiagnostics';

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_BACKUP_COUNT = 2;
const MAX_NAME_LENGTH = 96;
const MAX_ATTRIBUTE_COUNT = 16;
const MAX_ATTRIBUTE_KEY_LENGTH = 48;
const MAX_ATTRIBUTE_STRING_LENGTH = 96;
const SAFE_CODE_PATTERN = /^[a-zA-Z0-9_.:-]+$/u;
const PROHIBITED_ATTRIBUTE_KEY_PATTERN =
  /(?:id|path|cwd|args?|command|prompt|content|output|error|stack|cause|token|secret|credential|apikey)$/iu;

interface DiagnosticsFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  appendFile(
    path: string,
    data: string,
    options: { encoding: 'utf8'; mode: number },
  ): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

interface LocalDiagnosticsOptions {
  readonly directory: string;
  readonly output: Pick<vscode.OutputChannel, 'appendLine' | 'show' | 'dispose'>;
  readonly now?: () => Date;
  readonly maxFileBytes?: number;
  readonly backupCount?: number;
  readonly fileSystem?: DiagnosticsFileSystem;
}

interface PersistedDiagnosticRecord {
  readonly timestamp: string;
  readonly sequence: number;
  readonly source: 'host' | 'sdk';
  readonly level: RuntimeDiagnosticEvent['level'];
  readonly name: string;
  readonly attributes?: Readonly<
    Record<string, RuntimeDiagnosticAttribute>
  >;
}

const nodeFileSystem: DiagnosticsFileSystem = {
  mkdir,
  appendFile,
  stat,
  rename,
  unlink,
};

export class LocalDiagnostics implements RuntimeDiagnosticSink {
  readonly filePath: string;
  readonly observability: DroidObservability;

  private readonly directory: string;
  private readonly output: LocalDiagnosticsOptions['output'];
  private readonly now: () => Date;
  private readonly maxFileBytes: number;
  private readonly backupCount: number;
  private readonly fileSystem: DiagnosticsFileSystem;
  private writeQueue: Promise<void> = Promise.resolve();
  private sequence = 0;
  private disposed = false;

  constructor(options: LocalDiagnosticsOptions) {
    this.directory = options.directory;
    this.output = options.output;
    this.now = options.now ?? (() => new Date());
    this.maxFileBytes =
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.backupCount = options.backupCount ?? DEFAULT_BACKUP_COUNT;
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.filePath = join(this.directory, 'droidvisx.jsonl');
    this.observability = {
      logger: {
        log: (event) => this.recordSdkLog(event),
      },
      metrics: {
        record: (event) => this.recordSdkMetric(event),
      },
    };
  }

  record(event: RuntimeDiagnosticEvent): void {
    this.enqueue('host', event);
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
    this.enqueue('sdk', {
      level: event.level,
      name: projectSdkLogName(event),
      attributes: projectAttributes(event.attributes),
    });
  }

  private recordSdkMetric(event: DroidMetricEvent): void {
    this.enqueue('sdk', {
      level: 'debug',
      name: 'sdk.metric',
      attributes: {
        metric: safeCode(event.name, 'unclassified'),
        kind: event.kind,
        unit: event.unit,
        value: Number.isFinite(event.value) ? event.value : 0,
        ...projectAttributes(event.attributes),
      },
    });
  }

  private enqueue(
    source: PersistedDiagnosticRecord['source'],
    event: RuntimeDiagnosticEvent,
  ): void {
    if (this.disposed) {
      return;
    }
    const record: PersistedDiagnosticRecord = {
      timestamp: this.now().toISOString(),
      sequence: this.sequence,
      source,
      level: event.level,
      name: safeCode(event.name, `${source}.event`),
      ...(event.attributes === undefined
        ? {}
        : { attributes: projectAttributes(event.attributes) }),
    };
    this.sequence += 1;

    const line = `${JSON.stringify(record)}\n`;
    try {
      this.output.appendLine(formatOutputRecord(record));
    } catch {
      // Keep file diagnostics working when the Output Channel is unavailable.
    }
    this.writeQueue = this.writeQueue
      .then(() => this.writeLine(line))
      .catch(() => {
        // Sink failures are contained and later records can still be queued.
      });
  }

  private async writeLine(line: string): Promise<void> {
    await this.fileSystem.mkdir(this.directory, { recursive: true });
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if ((await this.currentSize()) + lineBytes > this.maxFileBytes) {
      await this.rotate();
    }
    await this.fileSystem.appendFile(this.filePath, line, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private async currentSize(): Promise<number> {
    try {
      return (await this.fileSystem.stat(this.filePath)).size;
    } catch (error) {
      if (isMissingFile(error)) {
        return 0;
      }
      throw error;
    }
  }

  private async rotate(): Promise<void> {
    if (this.backupCount <= 0) {
      await this.removeIfPresent(this.filePath);
      return;
    }
    await this.removeIfPresent(`${this.filePath}.${this.backupCount}`);
    for (let index = this.backupCount - 1; index >= 1; index -= 1) {
      await this.renameIfPresent(
        `${this.filePath}.${index}`,
        `${this.filePath}.${index + 1}`,
      );
    }
    await this.renameIfPresent(this.filePath, `${this.filePath}.1`);
  }

  private async removeIfPresent(path: string): Promise<void> {
    try {
      await this.fileSystem.unlink(path);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  private async renameIfPresent(from: string, to: string): Promise<void> {
    try {
      await this.fileSystem.rename(from, to);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }
}

function projectAttributes(
  attributes:
    | Readonly<Record<string, RuntimeDiagnosticAttribute>>
    | undefined,
): Readonly<Record<string, RuntimeDiagnosticAttribute>> | undefined {
  if (attributes === undefined) {
    return undefined;
  }
  const projected: Record<string, RuntimeDiagnosticAttribute> = {};
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    if (Object.keys(projected).length >= MAX_ATTRIBUTE_COUNT) {
      break;
    }
    const key = safeCode(rawKey, '');
    if (
      key.length === 0 ||
      key.length > MAX_ATTRIBUTE_KEY_LENGTH ||
      PROHIBITED_ATTRIBUTE_KEY_PATTERN.test(key)
    ) {
      continue;
    }
    if (typeof rawValue === 'string') {
      projected[key] = safeCode(rawValue, 'redacted').slice(
        0,
        MAX_ATTRIBUTE_STRING_LENGTH,
      );
    } else if (
      typeof rawValue === 'number' &&
      !Number.isFinite(rawValue)
    ) {
      projected[key] = 0;
    } else {
      projected[key] = rawValue;
    }
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
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
      return safeCode(event.name, 'sdk.log');
  }
}

function safeCode(value: string, fallback: string): string {
  const bounded = value.slice(0, MAX_NAME_LENGTH);
  return bounded.length > 0 && SAFE_CODE_PATTERN.test(bounded)
    ? bounded
    : fallback;
}

function formatOutputRecord(record: PersistedDiagnosticRecord): string {
  const attributes =
    record.attributes === undefined
      ? ''
      : ` ${JSON.stringify(record.attributes)}`;
  return `[${record.timestamp}] [${record.level}] ${record.source}:${record.name}${attributes}`;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
