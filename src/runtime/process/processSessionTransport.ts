import type { StringFramedDroidClientTransport } from '@factory/droid-sdk/node';

export interface ProcessSessionTransport extends StringFramedDroidClientTransport {
  connect(): Promise<void>;
}

export function createProvisionalProcessTransport(
  source: ProcessSessionTransport,
): ProcessSessionTransport {
  let close: Promise<void> | undefined;
  return {
    get isConnected() {
      return source.isConnected;
    },
    connect() {
      return source.connect();
    },
    send(message) {
      return source.send(message);
    },
    onMessage(handler) {
      source.onMessage(handler);
    },
    onError(handler) {
      source.onError(handler);
    },
    close() {
      close ??= Promise.resolve().then(() => source.close());
      return close;
    },
  };
}
