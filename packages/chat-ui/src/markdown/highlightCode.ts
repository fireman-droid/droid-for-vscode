import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  cjs: 'javascript',
  'c#': 'csharp',
  'c++': 'cpp',
  cs: 'csharp',
  h: 'c',
  hpp: 'cpp',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  kt: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  patch: 'diff',
  ps: 'bash',
  ps1: 'bash',
  powershell: 'bash',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yml: 'yaml',
  zsh: 'bash',
};

/** Resolve file previews through the same language registry as fenced code. */
export function codeLanguageForPath(path: string): string | undefined {
  const extension = path.match(/\.([^./\\]+)$/)?.[1]?.toLocaleLowerCase();
  if (extension === undefined) return undefined;
  const language = LANGUAGE_ALIASES[extension] ?? extension;
  return hljs.getLanguage(language) === undefined ? undefined : language;
}

/**
 * Highlights code and returns HTML produced by highlight.js, or null when
 * the language is unknown. highlight.js escapes all input text, so the
 * returned HTML only contains the escaped code plus `span.hljs-*` wrappers.
 */
export function highlightCode(code: string, language: string): string | null {
  const normalized = language.toLocaleLowerCase();
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized;
  if (hljs.getLanguage(resolved) === undefined) {
    return null;
  }
  try {
    return hljs.highlight(code, {
      language: resolved,
      ignoreIllegals: true,
    }).value;
  } catch {
    return null;
  }
}
