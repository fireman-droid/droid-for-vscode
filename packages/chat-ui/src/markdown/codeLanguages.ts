import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
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
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

interface CodeLanguage {
  readonly name: string;
  readonly grammar: LanguageFn;
  readonly aliases?: readonly string[];
  readonly embedded?: readonly string[];
  readonly detect?: boolean;
}

// One registry for fences, file previews, reasoning and review. Grammar aliases
// come from the library; only extra file extensions belong here. To add a
// language, register its grammar and metadata here, without changing consumers.
const languages: readonly CodeLanguage[] = [
  { name: 'bash', grammar: bash, aliases: ['shell', 'zsh'] },
  { name: 'c', grammar: c, aliases: ['h'] },
  { name: 'cpp', grammar: cpp, aliases: ['c++'] },
  { name: 'csharp', grammar: csharp, aliases: ['c#'] },
  { name: 'css', grammar: css },
  { name: 'diff', grammar: diff, detect: false },
  { name: 'go', grammar: go },
  { name: 'java', grammar: java },
  { name: 'javascript', grammar: javascript },
  { name: 'json', grammar: json },
  { name: 'kotlin', grammar: kotlin, aliases: ['kts'] },
  { name: 'markdown', grammar: markdown, detect: false },
  { name: 'php', grammar: php },
  { name: 'plaintext', grammar: plaintext, aliases: ['plain', 'log', 'none', 'nohighlight'], detect: false },
  { name: 'powershell', grammar: powershell, aliases: ['ps1', 'psm1', 'psd1'] },
  { name: 'python', grammar: python },
  { name: 'ruby', grammar: ruby },
  { name: 'rust', grammar: rust },
  { name: 'sql', grammar: sql },
  { name: 'swift', grammar: swift },
  { name: 'typescript', grammar: typescript },
  { name: 'xml', grammar: xml, aliases: ['vue'], embedded: ['javascript', 'typescript', 'css'] },
  { name: 'yaml', grammar: yaml },
];

export const highlighter = hljs.newInstance();
const aliases = new Map<string, string>();
for (const language of languages) {
  highlighter.registerLanguage(language.name, language.grammar);
  const registered = highlighter.getLanguage(language.name)!;
  for (const alias of [language.name, ...(registered.aliases ?? []), ...(language.aliases ?? [])]) {
    aliases.set(alias.toLowerCase(), language.name);
  }
}

export const detectionLanguages = languages.filter((language) => language.detect !== false).map((language) => language.name);
export const embeddedLanguages = (name: string): readonly string[] => languages.find((language) => language.name === name)?.embedded ?? [];

export function resolveCodeLanguage(language?: string | null): string | undefined {
  return language ? aliases.get(language.trim().toLowerCase()) : undefined;
}

export function codeLanguageForPath(path: string): string | undefined {
  const filename = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  return resolveCodeLanguage(filename.match(/\.([^.]+)$/)?.[1]);
}
