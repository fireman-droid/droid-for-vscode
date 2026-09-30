import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const MANAGEMENT_SECTIONS = ['skills', 'plugins', 'marketplaces', 'mcp', 'defaults', 'terminals', 'updates', 'worktrees', 'archive', 'history-note'] as const;
export type ManagementSection = typeof MANAGEMENT_SECTIONS[number];
export interface ManagementOpenMessage {
  readonly type: 'capabilities.manage';
  readonly section: ManagementSection;
}
export function parseManagementOpen(value: unknown): ManagementOpenMessage | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'section']) ||
    value.type !== 'capabilities.manage' ||
    !(MANAGEMENT_SECTIONS as readonly unknown[]).includes(value.section)) return undefined;
  return { type: 'capabilities.manage', section: value.section as ManagementSection };
}
