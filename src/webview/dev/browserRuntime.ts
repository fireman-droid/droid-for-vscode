import type { WebviewToHostMessage } from '../../shared/bridgeMessages';

interface BrowserVsCodeApi {
  getState(): unknown;
  postMessage(message: WebviewToHostMessage): void;
  setState(state: unknown): void;
}

interface BrowserConnection {
  readonly bridgePort: number;
  readonly token: string;
}

const CONNECTION_KEY = 'dvx.browser-dev.connection';
const RECONNECT_DELAY_MS = 500;

export function createBrowserRuntime(): BrowserVsCodeApi {
  const connection = readConnection();
  const bridgeUrl = `http://127.0.0.1:${connection.bridgePort}`;
  let persistedState: unknown = {};
  let readyMessage: WebviewToHostMessage | null = null;
  let stopped = false;
  let streamConnected = false;
  let outbound = Promise.resolve();

  const enqueue = (message: WebviewToHostMessage): void => {
    outbound = outbound.then(async () => {
      const response = await fetch(`${bridgeUrl}/message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        throw new Error(`Browser dev bridge rejected a message (${response.status}).`);
      }
    }).catch(() => undefined);
  };
  const send = (message: WebviewToHostMessage): void => {
    if (message.type === 'webview.ready') {
      readyMessage = message;
      if (!streamConnected) {
        return;
      }
    }
    enqueue(message);
  };

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const response = await fetch(`${bridgeUrl}/events`, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${connection.token}`,
          },
          cache: 'no-store',
        });
        if (!response.ok || response.body === null) {
          throw new Error(
            `Browser dev bridge connection failed (${response.status}).`,
          );
        }
        streamConnected = true;
        if (readyMessage !== null) {
          enqueue(readyMessage);
        }
        await readEventStream(response.body);
      } catch {
        if (stopped) {
          return;
        }
      } finally {
        streamConnected = false;
      }
      await delay(RECONNECT_DELAY_MS);
    }
  };

  void connect();
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
    },
    { once: true },
  );

  return {
    getState: () => persistedState,
    setState: (state) => {
      persistedState = state;
    },
    postMessage: send,
  };
}

function readConnection(): BrowserConnection {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fragmentPort = fragment.get('bridgePort');
  const fragmentToken = fragment.get('token');
  if (fragmentPort !== null && fragmentToken !== null) {
    sessionStorage.setItem(
      CONNECTION_KEY,
      JSON.stringify({
        bridgePort: Number(fragmentPort),
        token: fragmentToken,
      }),
    );
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  const value = sessionStorage.getItem(CONNECTION_KEY);
  if (value === null) {
    throw new Error(
      'This browser page was not opened by DroidVisX: Start Browser Dev Client.',
    );
  }
  const parsed = JSON.parse(value) as {
    readonly bridgePort?: unknown;
    readonly token?: unknown;
  };
  if (
    !Number.isInteger(parsed.bridgePort) ||
    (parsed.bridgePort as number) < 1 ||
    (parsed.bridgePort as number) > 65_535 ||
    typeof parsed.token !== 'string' ||
    !/^[A-Za-z0-9_-]{40,128}$/u.test(parsed.token)
  ) {
    sessionStorage.removeItem(CONNECTION_KEY);
    throw new Error('The DroidVisX browser dev connection is invalid.');
  }
  return {
    bridgePort: parsed.bridgePort as number,
    token: parsed.token,
  };
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) {
        break;
      }
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data.length > 0) {
        window.dispatchEvent(
          new MessageEvent('message', { data: JSON.parse(data) }),
        );
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
