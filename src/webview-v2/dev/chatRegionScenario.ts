import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';

// Controlled content only; never load a saved user conversation into the preview.
export function chatRegionTranscript(): SessionTranscriptItem[] {
  const turnId = 'chat-region-turn';
  const tool = (id: string, toolName: string, action: string, extra: Partial<ToolTranscriptItem> = {}): ToolTranscriptItem => ({
    kind: 'tool', id, turnId, toolUseId: id, toolName, action,
    status: 'completed', progressCount: 0, latestUpdateKind: null, ...extra,
  });
  return [
    { kind: 'user', id: 'chat-region-question', messageId: 'chat-region-question',
      text: '检查聊天区域：待办、读取、搜索、文件修改、成功和失败命令。最后输出包含标题、列表、表格、长路径和代码块的完整说明。' },
    { kind: 'thinking', id: 'chat-region-thinking', turnId, status: 'complete', durationMs: 1800, truncated: false,
      text: '先检查受控样例，再验证修改与命令输出。\n\n保留真实顺序，不把操作片段当成整轮净变化。' },
    tool('chat-region-todo', 'TodoWrite', 'Update todos', {
      detailKind: 'plan',
      detail: '1. [completed] Inspect source and search results\n2. [completed] Apply a small file change\n3. [completed] Check successful and failed commands',
    }),
    tool('chat-region-list', 'LS', 'List files', {
      target: 'src',
      resultPreview: { availability: 'available', source: { tool: 'LS', path: 'src', callId: 'chat-region-list' }, text: 'chat/\ncontent/\nstyles/\npackage.json', truncated: false },
    }),
    tool('chat-region-read', 'Read', 'Read file', {
      filePath: 'src/chat/example.ts', durationMs: 300,
      resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/chat/example.ts', callId: 'chat-region-read' }, text: 'export const spacing = 4;\nexport const ready = true;', truncated: false },
    }),
    tool('chat-region-grep', 'Grep', 'Search source', {
      target: 'spacing',
      resultPreview: { availability: 'available', source: { tool: 'Grep', path: 'src', callId: 'chat-region-grep' }, text: 'src/chat/example.ts:1:export const spacing = 4;', truncated: false },
    }),
    tool('chat-region-edit', 'ApplyPatch', 'Edited file', {
      filePath: 'src/chat/example.ts',
      operationDiff: { status: 'ready', source: 'successful-tool-input', files: [{ path: 'src/chat/example.ts', kind: 'modified', patch: '@@ -1,2 +1,3 @@\n-export const spacing = 12;\n+export const spacing = 4;\n export const ready = true;\n+export const width = 720;' }] },
    }),
    tool('chat-region-success', 'Execute', 'Run checks', {
      detailKind: 'command', detail: 'node --check src/chat/example.js', durationMs: 400, outputTail: 'Syntax check completed.\nProcess exited with code 0',
    }),
    tool('chat-region-output', 'Execute', 'Print terminal output', {
      detailKind: 'command', detail: 'node scripts/print-fixture.mjs', durationMs: 500,
      outputTail: Array.from({ length: 30 }, (_, index) => `Line ${String(index + 1).padStart(2, '0')}: bounded terminal output`).join('\n'),
    }),
    tool('chat-region-failure', 'Execute', 'Expected command failure', {
      status: 'failed', detailKind: 'command', detail: 'node missing-fixture.mjs',
      durationMs: 200, outputTail: 'Error: Cannot find module missing-fixture.mjs', errorMessage: 'Process exited with code 1',
    }),
    tool('chat-region-recovery', 'Execute', 'Verify recovery', {
      detailKind: 'command', detail: 'node --version', outputTail: 'The follow-up command completed successfully.',
    }),
    { kind: 'assistant', id: 'chat-region-answer', turnId, text: [
      '# 聊天区域检查',
      '',
      '已完成受控样例检查。下面保留不同内容的真实结构，用于比较文字密度、段落间距和交互状态。',
      '',
      '这一段包含 **重要结论**、*补充说明*、~~已替换内容~~，以及 `inline code`。普通段落保持紧凑，标题负责区分章节。',
      '',
      '## 文件与命令',
      '',
      '- 已读取源文件，并完成一次小范围修改。',
      '  - 保留原始文件路径。',
      '  - 每条活动可以独立展开。',
      '- 已检查正常输出与预期失败。',
      '',
      '1. 展开活动摘要。',
      '2. 同时打开读取和目录列表。',
      '3. 查看失败命令，再查看恢复记录。',
      '',
      '### 验证清单',
      '',
      '- [x] 标题、段落与嵌套列表',
      '- [x] 长路径换行与表格滚动',
      '- [ ] 在 Cursor 中确认最终外观',
      '',
      '| 内容 | 预期 | 状态 |',
      '| --- | --- | --- |',
      '| 正文 | 13px / 19.5px | 已展示 |',
      '| 输入主体 | 44px，多行增长 | 已展示 |',
      '| 工具结果 | 独立展开，内部滚动 | 可检查 |',
      '',
      '> 工具操作片段只描述该次操作。完整 Review 仍使用已有快照和恢复保护。',
      '',
      '长文件路径：`src/features/operations/management/activities/components/editors/ActivityEditor.vue`。路径应该在正文范围内自然换行，点击仍打开文件。',
      '',
      '参照链接：[Cursor](https://cursor.com)。',
      '',
      '```typescript',
      'type Result = { ready: boolean; width: number };',
      'export function inspectChat(): Result {',
      '  return { ready: true, width: 720 };',
      '}',
      '```',
      '',
      '```json',
      '{ "theme": "light", "lineHeight": 19.5, "safe": true }',
      '```',
      '',
      '```diff',
      '-const spacing = 12;',
      '+const spacing = 4;',
      '```',
      '',
      '---',
      '',
      '## 结论',
      '',
      '消息、工具、代码和输入区使用同一条聊天轨道。保留 Droid 的实际能力，不添加无法执行的操作。',
    ].join('\n') },
  ];
}
