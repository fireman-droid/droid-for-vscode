interface DelegatedTask {
  readonly type: string;
  readonly complexity: string | null;
  readonly description: string;
  readonly task: string;
}

export function parseDelegatedTask(text: string): DelegatedTask | null {
  if (!text.startsWith('# Task Tool Invocation')) {
    return null;
  }
  const type = readInvocationField(text, 'Subagent type');
  const description = readInvocationField(text, 'Task description');
  const task = text
    .match(
      /## Task\s*\r?\n---BEGIN TASK FROM PARENT AGENT---\s*\r?\n([\s\S]*?)\r?\n---END TASK FROM PARENT AGENT---/,
    )?.[1]
    ?.trim();
  if (type === null || description === null || !task) {
    return null;
  }
  return {
    type,
    complexity: readInvocationField(text, 'Task complexity'),
    description,
    task,
  };
}

function readInvocationField(text: string, label: string): string | null {
  const prefix = `${label}:`;
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim() ?? '';
  return value.length === 0 ? null : value;
}
