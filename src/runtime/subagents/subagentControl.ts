import type { DaemonApi } from '../daemon/api';

import {
  MAX_SUBAGENT_ACTIVITIES,
  MAX_SUBAGENT_ACTIVITY_LENGTH,
  MAX_SUBAGENT_ACTIVITY_TARGET_LENGTH,
  type SubagentActivityItem,
} from '../../shared/protocol/subagentProtocol';
import {
  summarizeToolAction,
  toolNameCandidates,
} from '../../shared/transcript/toolActivity';
import { extractToolFilePaths, toWorkspaceRelativePath } from '../tools/toolFilePath';
import { extractToolTarget, normalizeTodoDetail } from '../tools/toolDetail';

/**
 * Host-facing observation surface for inline Task subagent cards.
 * Child session ids remain host-only; the public daemon snapshot is
 * projected to a bounded semantic activity trail.
 */
export interface SubagentControlGateway {
  sampleActivities(
    childSessionId: string,
    workspaceRoot: string,
  ): Promise<readonly SubagentActivityItem[]>;
}

/** Messages fetched per activity sample; newest tail is enough. */
const ACTIVITY_SAMPLE_LIMIT = 40;

export function createDaemonSubagentControl(
  getDroid: () => Promise<DaemonApi>,
): SubagentControlGateway {
  return {
    async sampleActivities(childSessionId, workspaceRoot) {
      try {
        const droid = await getDroid();
        const messages = await droid.sessions.getMessages(childSessionId, {
          limit: ACTIVITY_SAMPLE_LIMIT,
        });
        return projectSubagentActivities(messages, workspaceRoot);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Scans a `getMessages` payload newest-first and keeps the latest
 * semantic activity plus three preceding distinct activities. Raw
 * input and output never leave this Runtime projection.
 */
export function projectSubagentActivities(
  messages: unknown,
  workspaceRoot: string,
): readonly SubagentActivityItem[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  const activities: SubagentActivityItem[] = [];
  let previousFingerprint: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = contentOf(messages[index]);
    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const activity = activityOf(content[blockIndex], workspaceRoot);
      if (activity === null) {
        continue;
      }
      const fingerprint = `${activity.action}\u0000${activity.target ?? ''}`;
      if (fingerprint !== previousFingerprint) {
        activities.push(activity);
        previousFingerprint = fingerprint;
      }
      if (activities.length >= MAX_SUBAGENT_ACTIVITIES) {
        return activities;
      }
    }
  }
  return activities;
}

function contentOf(message: unknown): readonly unknown[] {
  if (typeof message !== 'object' || message === null) {
    return [];
  }
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? content : [];
}

function activityOf(block: unknown, workspaceRoot: string): SubagentActivityItem | null {
  if (
    typeof block !== 'object' ||
    block === null ||
    (block as { type?: unknown }).type !== 'tool_use'
  ) {
    return null;
  }
  const rawName = (block as { name?: unknown }).name;
  if (typeof rawName !== 'string') {
    return null;
  }
  const toolName = boundedText(rawName, MAX_SUBAGENT_ACTIVITY_LENGTH);
  if (toolName === null) {
    return null;
  }
  const input = (block as { input?: unknown }).input;
  const summarized = summarizeToolAction(toolName);
  const action = boundedText(
    summarized.startsWith('Used ') ? 'Continued delegated work' : summarized,
    MAX_SUBAGENT_ACTIVITY_LENGTH,
  );
  if (action === null) {
    return null;
  }
  return {
    action,
    target: targetOf(toolName, input, workspaceRoot),
  };
}

function targetOf(
  toolName: string,
  input: unknown,
  workspaceRoot: string,
): string | null {
  const names = toolNameCandidates(toolName);
  const target =
    fileTargetOf(toolName, input, workspaceRoot) ??
    executeTargetOf(names, input) ??
    todoTargetOf(names, input) ??
    skillTargetOf(names, input) ??
    extractToolTarget(toolName, input, workspaceRoot);
  return target === undefined
    ? null
    : boundedText(target, MAX_SUBAGENT_ACTIVITY_TARGET_LENGTH);
}

function fileTargetOf(
  toolName: string,
  input: unknown,
  workspaceRoot: string,
): string | undefined {
  const paths = extractToolFilePaths(toolName, input)
    .map((path) => toWorkspaceRelativePath(workspaceRoot, path))
    .filter((path): path is string => path !== undefined);
  const first = paths[0];
  if (first === undefined) {
    return undefined;
  }
  return paths.length === 1 ? first : `${first} + ${String(paths.length - 1)} files`;
}

function executeTargetOf(names: readonly string[], input: unknown): string | undefined {
  if (!names.includes('execute') || typeof input !== 'object' || input === null) {
    return undefined;
  }
  const command = (input as { command?: unknown }).command;
  if (typeof command !== 'string') {
    return undefined;
  }
  const sample = command.slice(0, 1_024).toLocaleLowerCase();
  if (
    /\b(vitest|jest|pytest)\b|(?:^|\s)(?:pnpm|npm|yarn)\s+(?:run\s+)?test\b/u.test(sample)
  ) {
    return 'Tests';
  }
  if (/\btsc\b|typecheck/u.test(sample)) {
    return 'TypeScript check';
  }
  if (
    /\b(eslint|stylelint)\b|(?:^|\s)(?:pnpm|npm|yarn)\s+(?:run\s+)?lint\b/u.test(sample)
  ) {
    return 'Lint check';
  }
  if (
    /\b(esbuild|webpack)\b|(?:^|\s)(?:pnpm|npm|yarn)\s+(?:run\s+)?build\b/u.test(sample)
  ) {
    return 'Build';
  }
  return undefined;
}

function todoTargetOf(names: readonly string[], input: unknown): string | undefined {
  if (!names.includes('todowrite') || typeof input !== 'object' || input === null) {
    return undefined;
  }
  const detail = normalizeTodoDetail((input as { todos?: unknown }).todos);
  const current = detail?.split('\n').find((line) => line.includes('[in_progress]'));
  return current?.replace(/^\d+\.\s+\[in_progress\]\s+/u, '');
}

function skillTargetOf(names: readonly string[], input: unknown): string | undefined {
  if (!names.includes('skill') || typeof input !== 'object' || input === null) {
    return undefined;
  }
  const skill = (input as { skill?: unknown }).skill;
  return typeof skill === 'string' ? skill : undefined;
}

function boundedText(value: string, maxLength: number): string | null {
  const bounded = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return bounded.length > 0 ? bounded : null;
}
