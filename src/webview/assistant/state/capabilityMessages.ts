import { advance } from './turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from './types';

export function reduceCapabilitiesMessage(
  state: AssistantWebviewState,
  event: Extract<
    StoreHostMessage,
    {
      type:
        | 'session.settings'
        | 'session.context'
        | 'session.tokenUsage'
        | 'session.model-catalog'
        | 'session.skills'
        | 'session.plugins'
        | 'session.mcp'
        | 'session.commands'
        | 'mcp.auth';
    }
  >,
): AssistantWebviewState {
  switch (event.type) {
    case 'session.settings':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            settings: event.settings,
          }
        : advance(state, event.sequence);

    case 'session.context':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            context: event.context,
          }
        : advance(state, event.sequence);

    case 'session.tokenUsage':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            tokenUsage: event.tokenUsage,
          }
        : advance(state, event.sequence);

    case 'session.model-catalog':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            modelCatalog: event.modelCatalog,
          }
        : advance(state, event.sequence);

    case 'session.skills': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A toggle/refresh in flight sends 'loading' with no items, and a
      // failed operation may arrive with an empty error payload; keep
      // showing the current list in both cases instead of blanking it.
      const skills =
        event.skills.status === 'loading' &&
        event.skills.items.length === 0 &&
        state.skills.items.length > 0
          ? { status: 'loading' as const, items: state.skills.items }
          : event.skills.status === 'error' &&
              event.skills.items.length === 0 &&
              state.skills.items.length > 0
            ? {
                status: 'error' as const,
                items: state.skills.items,
                message: event.skills.message,
              }
            : event.skills;
      return { ...state, sequence: event.sequence, skills };
    }

    case 'session.plugins': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A refresh in flight sends 'loading' with no items, and a failed
      // refresh arrives with an empty payload; keep showing the current
      // list in both cases instead of blanking it.
      const plugins =
        event.plugins.status === 'loading' &&
        event.plugins.items.length === 0 &&
        state.plugins.items.length > 0
          ? { status: 'loading' as const, items: state.plugins.items }
          : event.plugins.status === 'error' &&
              event.plugins.items.length === 0 &&
              state.plugins.items.length > 0
            ? {
                status: 'error' as const,
                items: state.plugins.items,
                message: event.plugins.message,
              }
            : event.plugins;
      return { ...state, sequence: event.sequence, plugins };
    }

    case 'session.mcp': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const mcp =
        event.mcp.status === 'loading' &&
        event.mcp.items.length === 0 &&
        state.mcp.items.length > 0
          ? { status: 'loading' as const, items: state.mcp.items }
          : event.mcp.status === 'error' &&
              event.mcp.items.length === 0 &&
              state.mcp.items.length > 0
            ? {
                status: 'error' as const,
                items: state.mcp.items,
                message: event.mcp.message,
              }
            : event.mcp;
      return { ...state, sequence: event.sequence, mcp };
    }

    case 'session.commands': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A refresh in flight sends 'loading' with no items; keep showing
      // the current list until the fresh one arrives.
      const commands =
        event.commands.status === 'loading' &&
        event.commands.items.length === 0 &&
        state.commands.items.length > 0
          ? {
              status: 'loading' as const,
              items: state.commands.items,
              recent: event.commands.recent,
            }
          : event.commands;
      return { ...state, sequence: event.sequence, commands };
    }

    case 'mcp.auth':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            mcpAuth: {
              serverName: event.serverName,
              phase: event.phase,
              message: event.message,
            },
          }
        : advance(state, event.sequence);
  }
}
