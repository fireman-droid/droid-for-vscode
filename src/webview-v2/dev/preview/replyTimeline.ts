import type { HostToWebviewMessage, ToolActivityMessage } from '../../../shared/bridgeMessages';

type ReplyMessage = Extract<HostToWebviewMessage, {
  type: 'thinking.delta' | 'thinking.complete' | 'assistant.delta' | 'tool.activity' | 'subagent.activity' | 'turn.state';
}>;
type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence'> : never;
export type ReplyEvent = WithoutSequence<ReplyMessage>;

/** Fixed illustrative events, never commands to a tool, model or child process. */
export function replyTimeline(sessionId: string, turnId: string): readonly { at: number; event: ReplyEvent }[] {
  const identity = { sessionId, turnId };
  const tool = (name: string, status: ToolActivityMessage['status'], extra: Partial<ToolActivityMessage> = {}): ReplyEvent => ({
    type: 'tool.activity', ...identity, toolUseId: `preview-${name}`, toolName: name,
    action: name === 'Task' ? 'Review example layout' : name === 'Read' ? 'Read example source' : 'Check example output',
    status, progressCount: status === 'running' ? 0 : 1,
    latestUpdateKind: status === 'running' ? null : 'tool-result', ...extra,
  });
  const child = { type: 'explorer', description: 'Simulated layout review', toolUseCount: 2 };
  return [
    { at: 900, event: { type: 'thinking.delta', ...identity, delta: 'Preparing a fixed UI demonstration, with no workspace or model access.', segmentIndex: 0, truncated: false } },
    { at: 1800, event: { type: 'thinking.complete', ...identity, durationMs: 900, segmentIndex: 0 } },
    { at: 2000, event: { type: 'assistant.delta', ...identity, delta: 'This is a simulated reply. ' } },
    { at: 2500, event: { type: 'assistant.delta', ...identity, delta: 'I’ll show the same streaming and activity controls used by the extension.\n\n' } },
    { at: 3300, event: tool('Read', 'running', { target: 'src/example.ts' }) },
    { at: 4400, event: tool('Read', 'completed', { target: 'src/example.ts', outputTail: '// Fixed preview content\nexport const preview = true;', durationMs: 1100 }) },
    { at: 5000, event: tool('Execute', 'running', { detailKind: 'command', detail: 'example-check (simulated)', outputTail: 'Simulated output: checking example…' }) },
    { at: 6500, event: tool('Execute', 'completed', { outputTail: 'Simulated check complete. No command was executed.', durationMs: 1500 }) },
    { at: 7100, event: tool('Task', 'running', { subagent: { ...child, status: 'running' } }) },
    { at: 7600, event: { type: 'subagent.activity', ...identity, toolUseId: 'preview-Task', activities: [
      { action: 'Read example layout', target: 'src/example.ts' },
      { action: 'Compare spacing in fixed fixture', target: 'Example controls' },
    ] } },
    { at: 9300, event: tool('Task', 'completed', { subagent: { ...child, status: 'completed', durationMs: 2200 }, durationMs: 2200 }) },
    { at: 10000, event: { type: 'assistant.delta', ...identity, delta: 'The example review is complete. ' } },
    { at: 10800, event: { type: 'assistant.delta', ...identity, delta: [
      'Here is fixed example code for testing selection, copy and line wrapping:',
      '', '```ts',
      'type ExampleStep = { label: string; delayMs: number };',
      '',
      'const steps: readonly ExampleStep[] = [',
      '  { label: "Waiting", delayMs: 900 },',
      '  { label: "Streaming example text", delayMs: 2000 },',
      '  { label: "Showing simulated tools and a child activity without reading files, running commands, or contacting any model provider", delayMs: 7100 },',
      '];',
      '',
      'function describeStep(step: ExampleStep): string {',
      '  return `${step.label} (${step.delayMs} ms)`;',
      '}',
      '',
      'const labels = steps.map(describeStep);',
      'console.log(labels.join("\\n"));',
      '```', '',
    ].join('\n') } },
    { at: 11400, event: { type: 'assistant.delta', ...identity, delta: '\nYou can send another message, queue one while I’m responding, or stop and reset this simulation.' } },
    { at: 12000, event: { type: 'turn.state', ...identity, status: 'completed' } },
  ];
}
