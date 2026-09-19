const MAX_IMAGE_PATH_LENGTH = 1024;
import { isPreviewableFilePath, isSafeWorkspaceRelativePath } from './pathPolicy';
import { toWorkspaceRelativePath, type PathLink } from './pathLink';

export interface PathPreviewWiring {
  readonly workspaceRoot: string | null;
  readonly previewFile: (relativePath: string) => void;
}

export function previewablePathOf(wiring: PathPreviewWiring | null, link: PathLink): string | null {
  if (wiring === null || wiring.workspaceRoot === null) return null;
  const relativePath = toWorkspaceRelativePath(wiring.workspaceRoot, link.path);
  if (relativePath === null || !isSafeWorkspaceRelativePath(relativePath) || !isPreviewableFilePath(relativePath)) return null;
  return relativePath;
}

export function isInlineHtmlPreviewCandidate(language: string | null, text: string): boolean {
  if (text.trim().length === 0) return false;
  if (language?.toLowerCase() === 'html') return true;
  const head = text.trimStart().slice(0, 15).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

export function isSafeMarkdownUrl(url: string | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//iu.test(url);
}

export function safeMarkdownUrlTransform(url: string): string {
  return isSafeMarkdownUrl(url) ? url : '';
}

export function isLocalImagePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_IMAGE_PATH_LENGTH) return false;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^[a-z]:[\\/]/iu.test(value)) return false;
  return /\.(?:png|jpe?g|gif|webp)$/iu.test(value);
}

export function markdownUrlTransform(url: string, key: string): string {
  return key === 'src' && isLocalImagePath(url) ? url : safeMarkdownUrlTransform(url);
}

export function decodeImagePath(src: string): string {
  let path = src;
  try { path = decodeURIComponent(src); } catch { /* Keep malformed percent-encoding as a literal path. */ }
  return path.startsWith('./') ? path.slice(2) : path;
}

/** Preserve artifact identity when the same HTML is reopened. */
export function stableSourceId(source: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

export function readCanvasTitle(source: string): string {
  const match = /<title(?:\s[^>]*)?>([^<]{1,120})<\/title>/iu.exec(source);
  return match?.[1]?.replace(/\s+/gu, ' ').trim() || 'Interactive HTML artifact';
}
