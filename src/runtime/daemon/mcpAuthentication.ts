import { SessionNotificationPayloadSchema } from '@factory/droid-sdk';
import type { DaemonApi } from './api';

export type McpAuthenticationOutcome = 'success' | 'failed' | 'cancelled';

/** OAuth material stays between Runtime and the native Host prompt, never the Bridge. */
export async function authenticateDaemonMcp(options: {
  readonly droid: DaemonApi;
  readonly sessionId: string;
  readonly serverName: string;
  readonly signal: AbortSignal;
  readonly requestCallback: (authUrl: string, signal: AbortSignal) => Promise<string | undefined>;
}): Promise<McpAuthenticationOutcome> {
  const { droid, sessionId, serverName } = options;
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let finished = false;
    let requested = false;
    let unsubscribe = () => {};
    const prompt = new AbortController();
    const finish = (outcome: McpAuthenticationOutcome, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      options.signal.removeEventListener('abort', cancel);
      prompt.abort();
      if (error !== undefined) reject(error); else resolve(outcome);
    };
    const cancel = () => {
      if (finished) return;
      void droid.mcp.cancelAuth({ sessionId, serverName }).then(
        (result) => result.success ? finish('cancelled') : finish('failed', new Error('Droid did not confirm cancellation.')),
        (error: unknown) => finish('failed', error),
      );
    };
    const timer = setTimeout(cancel, 120_000);
    options.signal.addEventListener('abort', cancel, { once: true });
    unsubscribe = droid.notifications.subscribe((event) => {
      if (finished || event.sessionId !== sessionId) return;
      const parsed = SessionNotificationPayloadSchema.safeParse(event.notification);
      if (!parsed.success) return;
      const notification = parsed.data;
      if (notification.type === 'mcp_auth_completed' && notification.serverName === serverName) {
        finish(notification.outcome);
      } else if (notification.type === 'mcp_auth_required' && notification.serverName === serverName && !requested) {
        requested = true;
        void (async () => {
          const auth = new URL(notification.authUrl);
          if (!['https:', 'http:'].includes(auth.protocol) || auth.username || auth.password)
            throw new Error('Droid returned an unsupported authentication URL.');
          const callbackText = await options.requestCallback(auth.href, prompt.signal);
          if (finished) return;
          options.signal.throwIfAborted();
          if (callbackText === undefined) { cancel(); return; }
          const callback = new URL(callbackText);
          if (callback.searchParams.get('state') !== notification.state)
            throw new Error('The authentication callback state does not match this request.');
          const redirect = auth.searchParams.get('redirect_uri');
          if (redirect !== null) {
            const expected = new URL(redirect);
            if (callback.protocol !== expected.protocol || callback.host !== expected.host || callback.pathname !== expected.pathname)
              throw new Error('The callback destination does not match this request.');
          }
          const code = callback.searchParams.get('code');
          const error = callback.searchParams.get('error');
          const result = code && code.length <= 8192
            ? await droid.mcp.submitAuthCode({ sessionId, serverName, code, state: notification.state })
            : error && error.length <= 256
              ? await droid.mcp.submitAuthError({ sessionId, serverName, error, state: notification.state })
              : null;
          if (result?.success !== true) throw new Error('Droid did not accept an authentication callback.');
          // An accepted code is not proof of sign-in; await mcp_auth_completed.
        })().catch((error: unknown) => {
          if (finished) return;
          void droid.mcp.cancelAuth({ sessionId, serverName }).then(
            () => finish('failed', error), (cancelError: unknown) => finish('failed', cancelError),
          );
        });
      }
    });
    void droid.mcp.authenticateServer({ sessionId, serverName }).then(
      (result) => { if (!result.success) finish('failed', new Error('Droid refused authentication.')); },
      (error: unknown) => finish('failed', error),
    );
  });
}
