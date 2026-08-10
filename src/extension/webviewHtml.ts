import { randomBytes } from 'node:crypto';

export interface WebviewSecurityContext {
  readonly cspSource: string;
  asWebviewUri(uri: WebviewResourceUri): WebviewResourceUri;
}

export interface WebviewResourceUri {
  toString(): string;
}

export interface WebviewAssets {
  readonly script: WebviewResourceUri;
  readonly style: WebviewResourceUri;
}

export function getWebviewHtml(
  webview: WebviewSecurityContext,
  assets: WebviewAssets,
  nonce = createNonce(),
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
    throw new Error('Webview nonce contains unsupported characters.');
  }

  const scriptUri = escapeHtmlAttribute(
    webview.asWebviewUri(assets.script).toString(),
  );
  const styleUri = escapeHtmlAttribute(
    webview.asWebviewUri(assets.style).toString(),
  );

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src 'none'; connect-src 'none';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DroidVisX</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
  return randomBytes(24).toString('base64url');
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}
