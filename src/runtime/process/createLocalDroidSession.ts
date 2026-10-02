import {
  ProcessTransport,
  createSession,
  listModels,
  resumeSession,
  type DroidObservability,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';
import { createCapturedSessionView } from '../session/capturedSessionView';
import { type RuntimeSessionTarget } from '../DroidRuntime';
import {
  createProvisionalProcessTransport,
  type ProcessSessionTransport,
} from './processSessionTransport';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../events/runtimeInteractions';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { appendProcessHistory } from './appendProcessHistory';

export interface LocalSessionDependencies {
  listModels: typeof listModels;
  createTransport(options: {
    cwd: string;
    observability?: DroidObservability;
  }): ProcessSessionTransport;
  createSession(options: {
    cwd: string;
    systemPrompt?: import('../../shared/protocol/systemPromptProtocol').SessionSystemPrompt;
    transport: StringFramedDroidClientTransport;
    observability?: DroidObservability;
    permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
    askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
  }): Promise<FactoryDroidSession>;
  resumeSession(
    sessionId: string,
    options: {
      transport: StringFramedDroidClientTransport;
      observability?: DroidObservability;
      permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
      askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
    },
  ): Promise<FactoryDroidSession>;
}

export const localSessionDependencies: LocalSessionDependencies = {
  listModels,
  createTransport: (options) => new ProcessTransport(options),
  createSession,
  resumeSession,
};

export async function createLocalDroidSession(
  {
    target,
    interactionHandler,
    observability,
  }: {
    target: RuntimeSessionTarget;
    interactionHandler: RuntimeInteractionHandler;
    observability?: DroidObservability;
  },
  dependencies: LocalSessionDependencies = localSessionDependencies,
): Promise<FactoryDroidSession> {
  if (target.kind === 'resume' && target.child) {
    throw new Error('Worker conversations require the daemon runtime mode.');
  }
  if (target.kind === 'new' && target.worktree === true) {
    // Only the daemon has the native create-worktree-and-run channel;
    // reaching this factory with a worktree target is a wiring bug and
    // must not silently produce a plain session in the workspace.
    throw new Error('Worktree sessions require the daemon runtime mode.');
  }
  const observabilityOptions = observability === undefined ? {} : { observability };
  const transport = createProvisionalProcessTransport(
    dependencies.createTransport({
      cwd: target.cwd,
      ...observabilityOptions,
    }),
  );

  try {
    await transport.connect();

    const interactionCallbacks = createRuntimeInteractionCallbacks(interactionHandler);
    const session =
      target.kind === 'resume'
        ? await dependencies.resumeSession(target.sessionId, {
            transport,
            ...observabilityOptions,
            ...interactionCallbacks,
          })
        : await dependencies.createSession({
            cwd: target.cwd,
            ...(target.systemPrompt === undefined ? {} : { systemPrompt: target.systemPrompt }),
            transport,
            ...observabilityOptions,
            ...interactionCallbacks,
          });

    return captureProcessSession(session);
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Preserve the connection or session-establishment failure.
    }
    throw error;
  }

  function captureProcessSession(session: FactoryDroidSession): FactoryDroidSession {
    const view = createCapturedSessionView(session);
    view.appendHistoryMessage = (text) => appendProcessHistory({ session, cwd: session.cwd ?? target.cwd, text,
      resume: () => createLocalDroidSession({ target: { kind: 'resume', cwd: session.cwd ?? target.cwd, sessionId: session.id },
        interactionHandler, observability }, dependencies) });
    view.readAvailableModels = () => dependencies.listModels({
      cwd: session.cwd ?? target.cwd,
      includeDisabled: true,
      ...observabilityOptions,
    });
    // SDK replacements are fresh handles. Bind Process capabilities to that
    // handle, so a later note releases and resumes the replacement session.
    if (session.compact) view.compact = async (params) => {
      const result = await session.compact!(params);
      return { ...result, session: captureProcessSession(result.session) };
    };
    if (session.fork) view.fork = async (params) => captureProcessSession(await session.fork!(params));
    if (session.rewind) view.rewind = async (params) => {
      const result = await session.rewind!(params);
      return { ...result, session: captureProcessSession(result.session) };
    };
    return view;
  }
}
