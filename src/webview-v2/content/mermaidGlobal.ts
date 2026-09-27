/**
 * Shared contract between the main webview bundle and the lazily
 * loaded mermaid bundle (`mermaidRuntime.ts`). A window global is the
 * only viable handoff channel: the webview CSP allows scripts by nonce
 * only, so native dynamic `import()` of a separate chunk would be
 * blocked, while an injected `<script>` can carry the page nonce.
 */
export type MermaidApi = typeof import('mermaid').default;

declare global {
  interface Window {
    __dvxMermaid?: MermaidApi;
  }
}
