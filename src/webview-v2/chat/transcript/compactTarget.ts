import { createContext } from 'react';
import type { ExploreCategory } from './activityGrouping';

export const GroupPathDisambiguationContext = createContext<ReadonlyMap<string, string>>(new Map());

const EXTENSIONLESS_FILES = new Set([
  'Makefile',
  'Dockerfile',
  'README',
  'LICENSE',
  'CHANGELOG',
  'Procfile',
  'Gemfile',
  'Rakefile',
]);

export function normalizeTargetPath(raw: string): string {
  const slash = raw.trim().replace(/\\+/gu, '/').replace(/\/+/gu, '/');
  if (!slash) return '';
  if (slash === '.' || slash === './') return '.';
  const noDot = slash.replace(/^(?:\.\/)+/u, '');
  if (!noDot) return '.';
  return noDot.length > 1 ? noDot.replace(/\/+$/u, '') : noDot;
}

function pathSegments(normalized: string): string[] {
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length > 1 && /^[a-z]:$/iu.test(segments[0]!)) return segments.slice(1);
  return segments;
}

function looksLikeFileName(segment: string): boolean {
  if (!segment) return false;
  return /\.[^.\s/\\]{1,12}$/u.test(segment) || EXTENSIONLESS_FILES.has(segment);
}

/** Disambiguate files in the same activity group only when basenames collide. */
export function buildGroupDisambiguation(paths: readonly string[]): ReadonlyMap<string, string> {
  const distinct = new Set<string>();
  for (const raw of paths) {
    const normalized = normalizeTargetPath(raw);
    if (normalized && normalized !== '.') distinct.add(normalized);
  }
  const byBasename = new Map<string, { normalized: string; parents: string[] }[]>();
  for (const normalized of distinct) {
    const segs = pathSegments(normalized);
    const base = segs.at(-1)?.toLocaleLowerCase();
    if (!base) continue;
    const list = byBasename.get(base) ?? [];
    list.push({ normalized, parents: segs.slice(0, -1) });
    byBasename.set(base, list);
  }
  const result = new Map<string, string>();
  for (const entries of byBasename.values()) {
    if (entries.length < 2) continue;
    let chosenDepth = 3;
    for (let depth = 1; depth <= 3; depth += 1) {
      const suffixes = entries.map((entry) => entry.parents.slice(-depth).join('/'));
      if (new Set(suffixes).size === entries.length) {
        chosenDepth = depth;
        break;
      }
    }
    for (const entry of entries) {
      const suffix = entry.parents.slice(-chosenDepth).join('/');
      if (suffix) result.set(entry.normalized, suffix);
    }
  }
  return result;
}

export function compactDirPath(raw: string): string {
  const normalized = normalizeTargetPath(raw);
  if (!normalized || normalized === '.') return '.';
  const segments = pathSegments(normalized);
  if (segments.length === 0) return raw.trim();
  return segments.slice(-2).join('/');
}

export function compactFileTarget(
  raw: string,
  disambiguation?: ReadonlyMap<string, string>,
): { readonly label: string; readonly detail?: string } {
  const normalized = normalizeTargetPath(raw);
  const segments = pathSegments(normalized);
  if (segments.length === 0) return { label: raw.trim() };
  const label = segments.at(-1)!;
  const detail = disambiguation?.get(normalized);
  return detail ? { label, detail } : { label };
}

export function compactSearchTarget(raw: string): { readonly label: string; readonly detail?: string } {
  const separator = raw.lastIndexOf(' · ');
  if (separator > 0) {
    const query = raw.slice(0, separator);
    const scope = raw.slice(separator + 3).trim();
    if (scope === '.' || /[\\/]/u.test(scope)) {
      const segs = pathSegments(normalizeTargetPath(scope));
      const detail = segs.length > 0 && looksLikeFileName(segs.at(-1)!) ? segs.at(-1)! : compactDirPath(scope);
      return { label: query, detail };
    }
  }
  return { label: raw };
}

export function compactGenericTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(' · ')) {
    const compacted = compactSearchTarget(trimmed);
    return [compacted.label, compacted.detail].filter(Boolean).join(' · ');
  }
  if (/[\\/]/u.test(trimmed)) {
    const segs = pathSegments(normalizeTargetPath(trimmed));
    if (segs.length === 0) return trimmed;
    return looksLikeFileName(segs.at(-1)!) ? segs.at(-1)! : compactDirPath(trimmed);
  }
  return trimmed;
}

export function compactExploreTarget(
  raw: string,
  category: ExploreCategory | null,
  disambiguation?: ReadonlyMap<string, string>,
): { readonly label: string; readonly detail?: string } {
  if (category === 'file' || category === 'diagnostics') {
    if (raw.includes(' · ')) return { label: raw };
    return compactFileTarget(raw, disambiguation);
  }
  if (category === 'folder') return { label: compactDirPath(raw) };
  if (category === 'search') return compactSearchTarget(raw);
  if (category === 'fetch') return { label: raw };
  return { label: compactGenericTarget(raw) };
}
