import {
  ATTACHMENT_KINDS,
  DIAGNOSTIC_SEVERITIES,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_BRIDGE_ID_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_IMAGE_DATA_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  MAX_TURN_TEXT_LENGTH,
  SESSION_HISTORY_STATUSES,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TOOL_ACTIVITY_UPDATE_KINDS,
  TOOL_DETAIL_KINDS,
  type AttachmentKind,
  type ChangedFileSummary,
  type SentAttachmentSummary,
  type SessionHistoryStatus,
  type SessionTranscriptItem,
  type ToolDetailKind,
} from '../shared/bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../shared/strictValidation';
import {
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptItemTextUnits,
} from '../shared/transcriptLimits';
import {
  hydrateHostTranscriptState,
  type HostTranscriptState,
} from './hostTranscriptState';
import {
  summarizeToolAction,
  type ToolActivityUpdateKind,
} from '../shared/toolActivity';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';

export const SESSION_RECOVERY_VERSION = 1;
export const SESSION_RECOVERY_STORAGE_KEY =
  'droidvisx.sessionRecovery';
export const MAX_RECOVERY_SESSIONS = 8;
export const MAX_RECOVERY_TEXT_UNITS =
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS;
export const SESSION_RECOVERY_DEBOUNCE_MS = 250;

export interface SessionRecoveryPersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type SessionRecoveryCache = HostTranscriptState;

interface StoredSession {
  readonly sessionId: string;
  readonly lastAccess: number;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: SessionHistoryStatus;
  readonly truncated: boolean;
}

interface StoredState {
  readonly version: typeof SESSION_RECOVERY_VERSION;
  readonly selectedSessionId: string | null;
  readonly sessions: readonly StoredSession[];
}

interface MutableSession {
  sessionId: string;
  lastAccess: number;
  cache: SessionRecoveryCache;
}

export class SessionRecoveryStore {
  private selectedSessionId: string | null = null;
  private readonly sessions = new Map<string, MutableSession>();
  private accessSequence = 0;
  private revision = 0;
  private persistedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeInFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly persistence: SessionRecoveryPersistence,
    private readonly storageKey = SESSION_RECOVERY_STORAGE_KEY,
    private readonly debounceMs = SESSION_RECOVERY_DEBOUNCE_MS,
  ) {}

  async load(): Promise<void> {
    if (this.disposed) {
      return;
    }

    let parsed: StoredState | undefined;
    try {
      parsed = parseStoredState(
        this.persistence.get<unknown>(this.storageKey),
      );
    } catch {
      parsed = undefined;
    }

    this.sessions.clear();
    this.selectedSessionId = parsed?.selectedSessionId ?? null;
    this.accessSequence = 0;
    if (parsed) {
      for (const session of parsed.sessions) {
        this.sessions.set(session.sessionId, {
          sessionId: session.sessionId,
          lastAccess: session.lastAccess,
          cache: hydrateHostTranscriptState({
            transcript: session.transcript,
            historyStatus: session.historyStatus,
            truncated: session.truncated,
          }),
        });
        this.accessSequence = Math.max(
          this.accessSequence,
          session.lastAccess,
        );
      }
    }
    this.revision = 0;
    this.persistedRevision = 0;
  }

  getSelectedSessionId(): string | null {
    return this.selectedSessionId;
  }

  selectSession(sessionId: string | null): void {
    if (
      this.disposed ||
      (sessionId !== null && !isId(sessionId)) ||
      this.selectedSessionId === sessionId
    ) {
      return;
    }
    this.selectedSessionId = sessionId;
    if (sessionId !== null) {
      this.touch(sessionId);
    }
    this.enforceLimits();
    this.changed();
  }

  readSession(sessionId: string): SessionRecoveryCache | undefined {
    if (this.disposed || !isId(sessionId)) {
      return undefined;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    session.lastAccess = this.nextAccess();
    this.changed();
    return cloneCache(session.cache);
  }

  writeSession(
    sessionId: string,
    cache: SessionRecoveryCache,
  ): void {
    if (this.disposed || !isId(sessionId)) {
      return;
    }
    const safeCache = parseCache(cache);
    if (!safeCache) {
      return;
    }
    this.sessions.set(sessionId, {
      sessionId,
      lastAccess: this.nextAccess(),
      cache: safeCache,
    });
    this.enforceLimits();
    this.changed();
  }

  updateSession(
    sessionId: string,
    update: (
      cache: SessionRecoveryCache | undefined,
    ) => SessionRecoveryCache,
  ): SessionRecoveryCache | undefined {
    if (this.disposed || !isId(sessionId)) {
      return undefined;
    }
    const current = this.sessions.get(sessionId);
    let next: SessionRecoveryCache;
    try {
      next = update(current ? cloneCache(current.cache) : undefined);
    } catch {
      return current ? cloneCache(current.cache) : undefined;
    }
    const safeCache = parseCache(next);
    if (!safeCache) {
      return current ? cloneCache(current.cache) : undefined;
    }
    this.sessions.set(sessionId, {
      sessionId,
      lastAccess: this.nextAccess(),
      cache: safeCache,
    });
    this.enforceLimits();
    this.changed();
    const stored = this.sessions.get(sessionId);
    return stored ? cloneCache(stored.cache) : undefined;
  }

  async flush(): Promise<void> {
    this.clearTimer();
    while (this.persistedRevision < this.revision) {
      if (this.writeInFlight) {
        await this.writeInFlight;
        continue;
      }
      const revision = this.revision;
      const snapshot = this.serialize();
      const write = Promise.resolve()
        .then(() =>
          this.persistence.update(this.storageKey, snapshot),
        )
        .catch(() => undefined)
        .then(() => {
          this.persistedRevision = Math.max(
            this.persistedRevision,
            revision,
          );
        })
        .finally(() => {
          if (this.writeInFlight === write) {
            this.writeInFlight = null;
          }
        });
      this.writeInFlight = write;
      await write;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return this.writeInFlight ?? Promise.resolve();
    }
    this.disposed = true;
    await this.flush();
  }

  private touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccess = this.nextAccess();
    }
  }

  private nextAccess(): number {
    if (this.accessSequence >= Number.MAX_SAFE_INTEGER) {
      const ordered = this.sortedSessions();
      ordered.forEach((session, index) => {
        session.lastAccess = index + 1;
      });
      this.accessSequence = ordered.length;
    }
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private enforceLimits(): void {
    while (this.sessions.size > MAX_RECOVERY_SESSIONS) {
      this.evictLeastRecentlyUsed();
    }

    while (this.totalTextUnits() > MAX_RECOVERY_TEXT_UNITS) {
      const leastRecent = this.sortedSessions()[0];
      if (!leastRecent) {
        break;
      }
      if (leastRecent.cache.transcript.length === 0) {
        this.sessions.delete(leastRecent.sessionId);
        continue;
      }
      leastRecent.cache = {
        transcript: leastRecent.cache.transcript.slice(1),
        historyStatus: 'partial',
        truncated: true,
      };
    }
  }

  private totalTextUnits(): number {
    let total = this.selectedSessionId?.length ?? 0;
    for (const session of this.sessions.values()) {
      total += sessionTextUnits({
        sessionId: session.sessionId,
        transcript: session.cache.transcript,
        historyStatus: session.cache.historyStatus,
      });
    }
    return total;
  }

  private evictLeastRecentlyUsed(): void {
    const leastRecent = this.sortedSessions()[0];
    if (leastRecent) {
      this.sessions.delete(leastRecent.sessionId);
    }
  }

  private sortedSessions(): MutableSession[] {
    return [...this.sessions.values()].sort(
      (left, right) =>
        left.lastAccess - right.lastAccess ||
        left.sessionId.localeCompare(right.sessionId),
    );
  }

  private changed(): void {
    this.revision += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private serialize(): StoredState {
    return {
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: this.selectedSessionId,
      sessions: this.sortedSessions().map((session) => ({
        sessionId: session.sessionId,
        lastAccess: session.lastAccess,
        // Image bytes never reach persistent storage: checkpoints keep
        // placeholder rows (metadata + byteLength) and the loadSession
        // reload path re-projects the full images.
        transcript: cloneTranscript(session.cache.transcript).map(
          (item) =>
            item.kind === 'image' && item.data.length > 0
              ? { ...item, data: '' }
              : item,
        ),
        historyStatus: session.cache.historyStatus,
        truncated: session.cache.truncated,
      })),
    };
  }
}

function parseStoredState(value: unknown): StoredState | undefined {
  try {
    if (
      !isStrictRecord(value) ||
      !hasExactKeys(value, [
        'version',
        'selectedSessionId',
        'sessions',
      ]) ||
      dataValue(value, 'version') !== SESSION_RECOVERY_VERSION
    ) {
      return undefined;
    }
    const selectedSessionId = dataValue(value, 'selectedSessionId');
    const sessionsValue = dataValue(value, 'sessions');
    if (
      (selectedSessionId !== null && !isId(selectedSessionId)) ||
      !isExactArray(sessionsValue, 0, MAX_RECOVERY_SESSIONS)
    ) {
      return undefined;
    }

    const sessions: StoredSession[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < sessionsValue.length; index += 1) {
      const session = parseStoredSession(
        dataValue(sessionsValue, String(index)),
      );
      if (!session || ids.has(session.sessionId)) {
        continue;
      }
      ids.add(session.sessionId);
      sessions.push(session);
    }
    if (
      (selectedSessionId?.length ?? 0) +
        sessions.reduce(
          (total, session) => total + sessionTextUnits(session),
          0,
        ) >
        MAX_RECOVERY_TEXT_UNITS
    ) {
      return undefined;
    }
    return {
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId,
      sessions,
    };
  } catch {
    return undefined;
  }
}

function parseStoredSession(value: unknown): StoredSession | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'sessionId',
      'lastAccess',
      'transcript',
      'historyStatus',
      'truncated',
    ])
  ) {
    return undefined;
  }
  const sessionId = dataValue(value, 'sessionId');
  const lastAccess = dataValue(value, 'lastAccess');
  const cache = parseCache({
    transcript: dataValue(value, 'transcript'),
    historyStatus: dataValue(value, 'historyStatus'),
    truncated: dataValue(value, 'truncated'),
  });
  if (
    !isId(sessionId) ||
    !Number.isSafeInteger(lastAccess) ||
    (lastAccess as number) < 0 ||
    !cache
  ) {
    return undefined;
  }
  return {
    sessionId,
    lastAccess: lastAccess as number,
    ...cache,
  };
}

function parseCache(value: unknown): SessionRecoveryCache | undefined {
  try {
    if (
      !isStrictRecord(value) ||
      !hasExactKeys(value, [
        'transcript',
        'historyStatus',
        'truncated',
      ])
    ) {
      return undefined;
    }
    const transcriptValue = dataValue(value, 'transcript');
    const historyStatus = dataValue(value, 'historyStatus');
    const truncated = dataValue(value, 'truncated');
    if (
      !isExactArray(
        transcriptValue,
        0,
        MAX_SESSION_TRANSCRIPT_ITEMS,
      ) ||
      !isOneOf(historyStatus, SESSION_HISTORY_STATUSES) ||
      typeof truncated !== 'boolean'
    ) {
      return undefined;
    }

    const transcript: SessionTranscriptItem[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < transcriptValue.length; index += 1) {
      const item = parseTranscriptItem(
        dataValue(transcriptValue, String(index)),
      );
      if (!item || ids.has(item.id)) {
        return undefined;
      }
      ids.add(item.id);
      transcript.push(item);
    }
    if (
      historyStatus === 'unavailable' &&
      (transcript.length > 0 || truncated)
    ) {
      return undefined;
    }
    return { transcript, historyStatus, truncated };
  } catch {
    return undefined;
  }
}

function parseTranscriptItem(
  value: unknown,
): SessionTranscriptItem | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const kind = dataValue(value, 'kind');
  switch (kind) {
    case 'user':
      return parseUser(value);
    case 'assistant':
      return parseAssistant(value);
    case 'thinking':
      return parseThinking(value);
    case 'tool':
      return parseTool(value);
    case 'changes':
      return parseChanges(value);
    case 'diagnostic':
      return parseDiagnostic(value);
    case 'image':
      return parseImage(value);
    default:
      return undefined;
  }
}

const IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Accepts image items with live bytes so in-memory cache updates keep
 * rendering; `serialize()` strips the bytes before anything reaches
 * persistent storage, so stored checkpoints only ever hold placeholders.
 */
function parseImage(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'image' }> | undefined {
  if (
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'origin',
      'mediaType',
      'data',
      'generated',
      'byteLength',
    ])
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const origin = dataValue(value, 'origin');
  const mediaType = dataValue(value, 'mediaType');
  const data = dataValue(value, 'data');
  const generated = dataValue(value, 'generated');
  const byteLength = dataValue(value, 'byteLength');
  return isId(id) &&
    isId(turnId) &&
    isOneOf(origin, IMAGE_ORIGINS) &&
    isOneOf(mediaType, IMAGE_MEDIA_TYPES) &&
    isBoundedString(data, MAX_IMAGE_DATA_LENGTH) &&
    IMAGE_BASE64_PATTERN.test(data as string) &&
    typeof generated === 'boolean' &&
    Number.isSafeInteger(byteLength) &&
    (byteLength as number) >= 0
    ? {
        id,
        kind: 'image',
        turnId,
        origin,
        mediaType,
        data,
        generated,
        byteLength: byteLength as number,
      }
    : undefined;
}

function parseUser(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'user' }> | undefined {
  const id = dataValue(value, 'id');
  const text = dataValue(value, 'text');
  const messageId = dataValue(value, 'messageId');
  const attachmentsValue = dataValue(value, 'attachments');
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'text'],
      ['messageId', 'attachments'],
    ) ||
    !isId(id) ||
    !isBoundedString(text, MAX_TURN_TEXT_LENGTH) ||
    (messageId !== undefined && !isId(messageId))
  ) {
    return undefined;
  }
  let attachments: SentAttachmentSummary[] | undefined;
  if (attachmentsValue !== undefined) {
    if (!isExactArray(attachmentsValue, 1, MAX_PENDING_ATTACHMENTS)) {
      return undefined;
    }
    attachments = [];
    for (const entry of attachmentsValue) {
      const attachment = parseSentAttachment(entry);
      if (attachment === undefined) {
        return undefined;
      }
      attachments.push(attachment);
    }
  }
  return {
    id,
    kind: 'user',
    text,
    ...(messageId === undefined ? {} : { messageId }),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function parseSentAttachment(
  value: unknown,
): SentAttachmentSummary | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const kind = dataValue(value, 'kind');
  const name = dataValue(value, 'name');
  const sizeBytes = dataValue(value, 'sizeBytes');
  return hasExactKeys(value, ['kind', 'name', 'sizeBytes']) &&
    isOneOf(kind, ATTACHMENT_KINDS) &&
    isNonEmptyBoundedString(name, MAX_ATTACHMENT_NAME_LENGTH) &&
    typeof sizeBytes === 'number' &&
    Number.isSafeInteger(sizeBytes) &&
    sizeBytes >= 0
    ? { kind: kind as AttachmentKind, name, sizeBytes }
    : undefined;
}

function parseAssistant(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> | undefined {
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const text = dataValue(value, 'text');
  return hasExactKeys(value, ['id', 'kind', 'turnId', 'text']) &&
    isId(id) &&
    isId(turnId) &&
    isBoundedString(text, MAX_ASSISTANT_TEXT_LENGTH)
    ? { id, kind: 'assistant', turnId, text }
    : undefined;
}

function parseThinking(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'thinking' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'text', 'status', 'truncated'],
      ['durationMs'],
    )
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const text = dataValue(value, 'text');
  const status = dataValue(value, 'status');
  const durationMs = dataValue(value, 'durationMs');
  const truncated = dataValue(value, 'truncated');
  if (
    !isId(id) ||
    !isId(turnId) ||
    !isBoundedString(text, MAX_THINKING_TEXT_LENGTH) ||
    !isOneOf(status, TRANSCRIPT_THINKING_STATUSES) ||
    (durationMs !== undefined &&
      (!Number.isSafeInteger(durationMs) || (durationMs as number) < 0)) ||
    typeof truncated !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id,
    kind: 'thinking',
    turnId,
    text,
    status,
    ...(durationMs === undefined
      ? {}
      : { durationMs: durationMs as number }),
    truncated,
  };
}

function parseTool(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'tool' }> | undefined {
  const legacyKeys = [
    'id',
    'kind',
    'turnId',
    'toolUseId',
    'toolName',
    'status',
  ] as const;
  const currentKeys = [
    ...legacyKeys,
    'action',
    'progressCount',
    'latestUpdateKind',
  ] as const;
  const legacy = hasExactKeys(value, legacyKeys);
  if (
    !legacy &&
    !hasExactKeys(value, currentKeys, [
      'durationMs',
      'filePath',
      'detailKind',
      'detail',
    ])
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const toolUseId = dataValue(value, 'toolUseId');
  const toolName = dataValue(value, 'toolName');
  const filePath = legacy ? undefined : dataValue(value, 'filePath');
  const detailKind = legacy ? undefined : dataValue(value, 'detailKind');
  const detail = legacy ? undefined : dataValue(value, 'detail');
  const action = legacy
    ? typeof toolName === 'string'
      ? summarizeToolAction(toolName)
      : undefined
    : dataValue(value, 'action');
  const status = dataValue(value, 'status');
  const progressCount = legacy
    ? 0
    : dataValue(value, 'progressCount');
  const latestUpdateKind = legacy
    ? null
    : dataValue(value, 'latestUpdateKind');
  const durationMs = legacy ? undefined : dataValue(value, 'durationMs');
  return isId(id) &&
    isId(turnId) &&
    isId(toolUseId) &&
    isNonEmptyBoundedString(toolName, MAX_TOOL_NAME_LENGTH) &&
    isNonEmptyBoundedString(action, MAX_TOOL_ACTION_SUMMARY_LENGTH) &&
    isOneOf(status, TRANSCRIPT_TOOL_STATUSES) &&
    Number.isSafeInteger(progressCount) &&
    (progressCount as number) >= 0 &&
    (progressCount as number) <= MAX_TOOL_PROGRESS_UPDATES_PER_TOOL &&
    (latestUpdateKind === null ||
      isOneOf(latestUpdateKind, TOOL_ACTIVITY_UPDATE_KINDS)) &&
    ((progressCount === 0 && latestUpdateKind === null) ||
      ((progressCount as number) > 0 && latestUpdateKind !== null)) &&
    (durationMs === undefined ||
      (Number.isSafeInteger(durationMs) && (durationMs as number) >= 0)) &&
    (filePath === undefined || isSafeWorkspaceRelativePath(filePath)) &&
    ((detailKind === undefined && detail === undefined) ||
      (isOneOf(detailKind, TOOL_DETAIL_KINDS) &&
        isNonEmptyBoundedString(detail, MAX_TOOL_DETAIL_LENGTH)))
    ? {
        id,
        kind: 'tool',
        turnId,
        toolUseId,
        toolName,
        action,
        status,
        progressCount: progressCount as number,
        latestUpdateKind:
          latestUpdateKind as ToolActivityUpdateKind | null,
        ...(durationMs === undefined
          ? {}
          : { durationMs: durationMs as number }),
        ...(filePath === undefined
          ? {}
          : { filePath: filePath as string }),
        ...(detailKind === undefined
          ? {}
          : {
              detailKind: detailKind as ToolDetailKind,
              detail: detail as string,
            }),
      }
    : undefined;
}

function parseChanges(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'changes' }> | undefined {
  if (!hasExactKeys(value, ['id', 'kind', 'turnId', 'files'])) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const filesValue = dataValue(value, 'files');
  if (
    !isId(id) ||
    !isId(turnId) ||
    !isExactArray(filesValue, 1, MAX_CHANGED_FILES_PER_TURN)
  ) {
    return undefined;
  }
  const files: ChangedFileSummary[] = [];
  const paths = new Set<string>();
  for (const fileValue of filesValue) {
    if (!isStrictRecord(fileValue)) {
      return undefined;
    }
    const path = dataValue(fileValue, 'path');
    const additions = dataValue(fileValue, 'additions');
    const deletions = dataValue(fileValue, 'deletions');
    if (
      !hasExactKeys(fileValue, ['path', 'additions', 'deletions']) ||
      !isSafeWorkspaceRelativePath(path) ||
      paths.has(path as string) ||
      !isNullableChangeCount(additions) ||
      !isNullableChangeCount(deletions)
    ) {
      return undefined;
    }
    paths.add(path as string);
    files.push({
      path: path as string,
      additions: additions as number | null,
      deletions: deletions as number | null,
    });
  }
  return { id, kind: 'changes', turnId, files };
}

function isNullableChangeCount(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

function parseDiagnostic(
  value: UnknownRecord,
): Extract<
  SessionTranscriptItem,
  { kind: 'diagnostic' }
> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'severity', 'code', 'message'],
      ['relatedSessionId'],
    )
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const severity = dataValue(value, 'severity');
  const code = dataValue(value, 'code');
  const message = dataValue(value, 'message');
  const relatedSessionId = dataValue(value, 'relatedSessionId');
  return isId(id) &&
    (turnId === null || isId(turnId)) &&
    isOneOf(severity, DIAGNOSTIC_SEVERITIES) &&
    isBoundedString(code, MAX_TURN_TEXT_LENGTH) &&
    isBoundedString(message, MAX_TURN_TEXT_LENGTH) &&
    (relatedSessionId === undefined || isId(relatedSessionId))
    ? {
        id,
        kind: 'diagnostic',
        turnId,
        severity,
        code,
        message,
        ...(relatedSessionId === undefined
          ? {}
          : { relatedSessionId }),
      }
    : undefined;
}

function dataValue(
  value: object,
  key: PropertyKey,
): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function sessionTextUnits(
  session: Pick<
    StoredSession,
    'sessionId' | 'transcript' | 'historyStatus'
  >,
): number {
  return (
    session.sessionId.length +
    session.historyStatus.length +
    session.transcript.reduce(
      (total, item) => total + transcriptItemTextUnits(item),
      0,
    )
  );
}

function cloneCache(cache: SessionRecoveryCache): SessionRecoveryCache {
  return {
    transcript: cloneTranscript(cache.transcript),
    historyStatus: cache.historyStatus,
    truncated: cache.truncated,
  };
}

function cloneTranscript(
  transcript: readonly SessionTranscriptItem[],
): SessionTranscriptItem[] {
  return transcript.map((item) => ({ ...item }));
}
