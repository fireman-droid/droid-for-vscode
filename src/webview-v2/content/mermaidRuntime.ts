import mermaid from 'mermaid';

import type {} from './mermaidGlobal';

// Entry point of the separate `dist/webview/mermaid.js` bundle. The
// main bundle injects it on demand (see assistant/mermaidRenderer.ts)
// the first time a completed mermaid code block needs rendering, so
// the first-screen bundle and P1 bootMs stay untouched.
window.__dvxMermaid = mermaid;
