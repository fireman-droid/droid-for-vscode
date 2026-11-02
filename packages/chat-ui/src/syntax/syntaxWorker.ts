import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import type { GrammarState } from 'shiki';
import { syntaxLanguage } from './syntaxLanguage';
import { syntaxHtml, syntaxTheme } from './syntaxTheme';
import type { SyntaxRequest, SyntaxResponse } from './syntaxProtocol';

// One lazily loaded highlighter per worker. The JavaScript engine uses the
// same TextMate grammars without relaxing the host's WebAssembly CSP.
const highlighter = createHighlighterCore({ themes: [syntaxTheme], langs: [], engine: createJavaScriptRegexEngine() });

interface StreamSession {
  language: string;
  completedLines: string[];
  completedHtml: string[];
  state: GrammarState | undefined;
}
const MAX_STREAM_SESSIONS = 32;
const streamSessions = new Map<string, StreamSession>();

function getStreamSession(streamKey: string, language: string, lines: readonly string[], completedEnd: number): StreamSession {
  const existing = streamSessions.get(streamKey);
  if (existing && existing.language === language && existing.completedLines.length <= completedEnd) {
    let matchesPrefix = true;
    for (let i = 0; i < existing.completedLines.length; i++) {
      if (existing.completedLines[i] !== lines[i]) {
        matchesPrefix = false;
        break;
      }
    }
    if (matchesPrefix) {
      streamSessions.delete(streamKey);
      streamSessions.set(streamKey, existing);
      return existing;
    }
  }
  const fresh: StreamSession = { language, completedLines: [], completedHtml: [], state: undefined };
  streamSessions.delete(streamKey);
  streamSessions.set(streamKey, fresh);
  if (streamSessions.size > MAX_STREAM_SESSIONS) {
    const oldest = streamSessions.keys().next().value;
    if (oldest !== undefined) streamSessions.delete(oldest);
  }
  return fresh;
}

async function highlight(request: SyntaxRequest): Promise<SyntaxResponse> {
  const language = syntaxLanguage(request.language, request.path, request.documents.find(document => document.text)?.text);
  if (!language) return { id: request.id, documents: [] };
  const parser = await highlighter;
  await parser.loadLanguage(bundledLanguages[language]);
  const documents: Record<number, string>[] = [];
  for (const document of request.documents) {
    if (document.text.length > 2 * 1024 * 1024) throw new Error('This source exceeds the syntax highlighting limit.');
    const lines = document.text.split('\n');
    if (document.streamKey && !document.lines) {
      const completedEnd = Math.max(0, lines.length - 1);
      const session = getStreamSession(document.streamKey, language, lines, completedEnd);
      for (let start = session.completedLines.length; start < completedEnd; start += 128) {
        const batch = lines.slice(start, Math.min(completedEnd, start + 128));
        const tokens = parser.codeToTokensBase(batch.join('\n'), {
          lang: language, theme: syntaxTheme.name!, grammarState: session.state,
          tokenizeMaxLineLength: 10_000, tokenizeTimeLimit: 50,
        });
        session.state = parser.getLastGrammarState(tokens);
        for (let index = 0; index < batch.length; index++) {
          session.completedLines.push(batch[index]!);
          session.completedHtml.push(syntaxHtml(tokens[index] ?? []));
        }
      }
      const html: Record<number, string> = {};
      for (let i = 0; i < session.completedHtml.length; i++) {
        html[i] = session.completedHtml[i]!;
      }
      if (lines.length > 0) {
        const tailTokens = parser.codeToTokensBase(lines[completedEnd]!, {
          lang: language, theme: syntaxTheme.name!, grammarState: session.state,
          tokenizeMaxLineLength: 10_000, tokenizeTimeLimit: 50,
        });
        html[completedEnd] = syntaxHtml(tailTokens[0] ?? []);
      }
      documents.push(html);
      continue;
    }
    const requested = document.lines ? new Set(document.lines) : undefined;
    const end = requested ? Math.min(lines.length, [...requested].reduce((max, line) => Math.max(max, line + 1), 0)) : lines.length;
    const html: Record<number, string> = {};
    let state: GrammarState | undefined;
    for (let start = 0; start < end; start += 128) {
      const batch = lines.slice(start, Math.min(end, start + 128));
      const tokens = parser.codeToTokensBase(batch.join('\n'), {
        lang: language, theme: syntaxTheme.name!, grammarState: state,
        tokenizeMaxLineLength: 10_000, tokenizeTimeLimit: 50,
      });
      state = parser.getLastGrammarState(tokens);
      for (let index = 0; index < batch.length; index++)
        if (!requested || requested.has(start + index)) html[start + index] = syntaxHtml(tokens[index] ?? []);
    }
    documents.push(html);
  }
  return { id: request.id, documents };
}
const worker = self as unknown as { onmessage: (event: MessageEvent<SyntaxRequest>) => void; postMessage(value: SyntaxResponse): void };
worker.onmessage = ({ data }) => {
  void highlight(data).then(result => worker.postMessage(result), error => worker.postMessage({
    id: data.id, documents: [], error: error instanceof Error ? error.message : 'Syntax highlighting failed.',
  }));
};
