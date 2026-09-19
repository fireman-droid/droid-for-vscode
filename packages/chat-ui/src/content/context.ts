import { createContext, useContext } from 'react';

export interface CanvasInlineArtifact { readonly artifactId: string; readonly title: string }
export interface LocalImageEntry { readonly status: string; readonly mediaType: string | null; readonly data: string }
import type { PathLink } from '../markdown/pathLink';
import type { MermaidOutcome } from '../markdown/diagramStyles';
export interface ContentActions {
  readonly openPath?: (link: PathLink) => void;
  readonly previewFile?: (relativePath: string) => void;
  readonly previewHtml?: (html: string, artifact: CanvasInlineArtifact) => void;
}

export interface ContentEnvironment {
  readonly actions?: ContentActions;
  readonly images?: {
    readonly entries: Readonly<Record<string, LocalImageEntry>>;
    readonly request: (path: string) => void;
  };
  readonly workspaceRoot: string | null;
  readonly theme: 'light' | 'dark';
  readonly maxPreviewHtmlLength?: number;
  readonly previewHtmlDescription?: string;
  readonly renderDiagram?: (text: string, theme: 'light' | 'dark') => Promise<MermaidOutcome>;
}

export const ContentContext = createContext<ContentEnvironment>({ workspaceRoot: null, theme: 'dark' });
export const ContentProvider = ContentContext.Provider;
export const MarkdownState = createContext({ streaming: false, thinking: false });
export const useContent = () => useContext(ContentContext);
