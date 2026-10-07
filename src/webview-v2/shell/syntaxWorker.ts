declare global { interface Window { __dvxSyntaxWorkerSource?: string } }

let loading: Promise<string> | undefined;
function loadSource(): Promise<string> {
  if (window.__dvxSyntaxWorkerSource) return Promise.resolve(window.__dvxSyntaxWorkerSource);
  if (loading) return loading;
  loading = new Promise<string>((resolve, reject) => {
    const entry = Array.from(document.scripts).find(script =>
      /\/(webview|review|models|mission-control|session-viewer)\.js(?:\?|$)/.test(script.src));
    const script = document.createElement('script');
    script.src = entry ? new URL('syntax.js', entry.src).href : new URL('/syntax.js', location.href).href;
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    const done = (error?: Error) => {
      clearTimeout(timer);
      script.remove();
      if (error) reject(error);
      else if (window.__dvxSyntaxWorkerSource) resolve(window.__dvxSyntaxWorkerSource);
      else reject(new Error('Syntax asset did not provide a worker.'));
    };
    const timer = setTimeout(() => done(new Error('Syntax asset could not be loaded in time.')), 15_000);
    script.onload = () => done();
    script.onerror = () => done(new Error('Syntax asset could not be loaded.'));
    document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

/** Load local grammar assets only when a source-code surface requests tokens. */
export async function createSyntaxWorker(): Promise<Worker> {
  const url = URL.createObjectURL(new Blob([await loadSource()], { type: 'text/javascript' }));
  try { return new Worker(url, { name: 'droid-source-syntax' }); }
  finally { URL.revokeObjectURL(url); }
}
