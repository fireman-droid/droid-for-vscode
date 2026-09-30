/** Presentation policy only; never grants tool execution or file access. */
export type ExploreCategory = 'file' | 'search' | 'folder' | 'fetch' | 'task-check' | 'skill' | 'diagnostics';
export interface ToolPresentation {
  readonly action: string;
  readonly formerAction: string;
  readonly category?: ExploreCategory;
  readonly target?: 'file' | 'directory' | 'search' | 'glob' | 'query' | 'skill' | 'github' | 'generic';
  readonly preview: 'workspace' | 'web' | 'github' | 'diagnostics' | 'generic' | 'none';
  readonly resultLabel?: string;
}
const TOOLS: Readonly<Record<string, ToolPresentation>> = {
  applypatch: { action: 'Apply patch', formerAction: 'Updated workspace files', preview: 'none' },
  askuser: { action: 'Ask for input', formerAction: 'Requested your input', preview: 'none' },
  create: { action: 'Create file', formerAction: 'Created workspace files', preview: 'none' },
  edit: { action: 'Edit file', formerAction: 'Updated workspace files', preview: 'none' },
  execute: { action: 'Run command', formerAction: 'Ran a local command', preview: 'none' },
  exitspecmode: { action: 'Present implementation plan', formerAction: 'Prepared an implementation plan', preview: 'none' },
  fetchurl: { action: 'Fetch URL', formerAction: 'Researched an external source', category: 'fetch', target: 'generic', preview: 'generic' },
  glob: { action: 'Find files', formerAction: 'Inspected workspace structure', category: 'search', target: 'glob', preview: 'workspace', resultLabel: 'Matched paths' },
  grep: { action: 'Search files', formerAction: 'Searched workspace content', category: 'search', target: 'search', preview: 'workspace', resultLabel: 'Matches' },
  ls: { action: 'List directory', formerAction: 'Inspected workspace structure', category: 'folder', target: 'directory', preview: 'workspace', resultLabel: 'Directory listing' },
  read: { action: 'Read file', formerAction: 'Read workspace files', category: 'file', target: 'file', preview: 'workspace', resultLabel: 'Source preview' },
  skill: { action: 'Load skill', formerAction: 'Loaded workflow guidance', category: 'skill', target: 'skill', preview: 'generic' },
  task: { action: 'Delegate task', formerAction: 'Delegated focused work', preview: 'none' },
  taskoutput: { action: 'Check task output', formerAction: 'Checked delegated work', category: 'task-check', preview: 'generic' },
  todowrite: { action: 'Update task plan', formerAction: 'Updated the task plan', preview: 'none' },
  websearch: { action: 'Search web', formerAction: 'Researched external sources', category: 'search', target: 'query', preview: 'web', resultLabel: 'Web search results' },
  write: { action: 'Write file', formerAction: 'Updated workspace files', preview: 'none' },
  search: { action: 'Search', formerAction: 'Used Search', target: 'search', preview: 'generic' },
  list: { action: 'List', formerAction: 'Used List', target: 'directory', preview: 'generic' },
  getidediagnostics: { action: 'IDE check', formerAction: 'Get Ide Diagnostics', category: 'diagnostics', target: 'generic', preview: 'diagnostics', resultLabel: 'IDE diagnostics' },
  githubgetfilecontents: { action: 'Get file contents', formerAction: 'Used github get file contents', category: 'fetch', target: 'github', preview: 'github', resultLabel: 'Repository content' },
};

/**
 * Lookup keys a raw SDK tool name may match under: the full name and
 * its namespace leaf, both stripped to lowercase alphanumerics. Shared
 * by Runtime input classification and the webview activity grouping.
 * Display-only MCP leaf parsing must not expand these trusted matches.
 */
export function toolNameCandidates(toolName: string): readonly [string, string] {
  const safeName = toolName.replace(/\p{Cc}/gu, '').trim();
  const leaf = safeName.split(/[.:/]/u).at(-1) ?? safeName;
  return [
    safeName.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase(),
    leaf.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase(),
  ];
}

export function toolPresentation(name: string): ToolPresentation | undefined {
  // Do not let an MCP server inherit native tool policies through its leaf name.
  if (name === 'github___get_file_contents') return TOOLS.githubgetfilecontents;
  if (/__+/u.test(name)) return undefined;
  for (const key of toolNameCandidates(name)) {
    if (Object.hasOwn(TOOLS, key) && key !== 'githubgetfilecontents') return TOOLS[key];
  }
  return undefined;
}

export function resultPreviewPolicy(name: string): ToolPresentation['preview'] {
  return toolPresentation(name)?.preview ?? 'generic';
}

export const CATEGORY_PRESENTATION: Readonly<Record<ExploreCategory, { action: string; nouns: readonly [string, string] }>> = {
  file: { action: 'Read', nouns: ['read', 'reads'] },
  search: { action: 'Search', nouns: ['search', 'searches'] },
  folder: { action: 'List', nouns: ['listing', 'listings'] },
  fetch: { action: 'Fetch', nouns: ['fetch', 'fetches'] },
  'task-check': { action: 'Check task', nouns: ['task check', 'task checks'] },
  skill: { action: 'Skill', nouns: ['skill', 'skills'] },
  diagnostics: { action: 'Check IDE diagnostics', nouns: ['IDE check', 'IDE checks'] },
};
