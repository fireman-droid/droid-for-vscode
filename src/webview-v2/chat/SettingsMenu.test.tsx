// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmedSessionSettings, ModelCatalogState } from '../../shared/protocol/settings';
import type { McpPanelState } from './composer/shared';
import { initialAssistantWebviewState } from '../state/initialState';
import { SessionSettingsPanel } from './SessionSettingsPanel';
import { McpPanel } from './McpPanel';
import { SettingsMenu } from './SettingsMenu';

afterEach(cleanup);

const confirmed: ConfirmedSessionSettings = {
  interactionMode: 'auto', modelId: 'session-model', reasoningEffort: 'medium', autonomyLevel: 'low',
  specModeModelId: 'draft-model', specModeReasoningEffort: 'high',
};
const catalog: ModelCatalogState = {
  status: 'ready',
  items: [
    { id: 'session-model', displayName: 'Session model', supportedReasoningEfforts: ['low', 'medium'], defaultReasoningEffort: 'low', isCustom: true, supportsImages: true, supportsImageGeneration: false, disabled: false },
    { id: 'draft-model', displayName: 'Draft model', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high', isCustom: true, supportsImages: true, supportsImageGeneration: false, disabled: false },
  ],
};

describe('V2 settings actions', () => {
  it('searches real skill and MCP names without matching unrelated descriptions', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialAssistantWebviewState, sessionId: 'session', connection: { status: 'connected' as const },
      settings: { status: 'ready' as const, value: confirmed }, modelCatalog: catalog,
      skills: { status: 'ready' as const, items: [
        { name: 'figma', description: 'Design integration', enabled: true, location: 'user' as const, userInvocable: false },
        { name: 'agent-browser', description: 'Includes Figma support', enabled: true, location: 'user' as const, userInvocable: false },
      ] },
      mcp: { status: 'ready' as const, items: [{ name: 'figma-mcp', status: 'connected' as const, toolCount: 0, requiresAuth: false, hasAuthTokens: false, tools: [] }] },
    };
    const onPageChange = vi.fn();
    render(<SettingsMenu state={state} port={{ postMessage: vi.fn() }} blocked={false} page="settings" onPageChange={onPageChange}
      onCompact={vi.fn()} compactPending={false} onNewSession={vi.fn()} theme={{ preference: 'auto', resolved: 'dark', onPreferenceChange: vi.fn() }} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search actions' }), 'figma');
    expect(screen.getByRole('button', { name: 'figma · Skill' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'agent-browser · Skill' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'figma-mcp · MCP' }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith('mcp');
  });

  it('uses nullable Spec overrides and keeps confirmed values until the Host settles the update', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const props = { catalog, disabled: false, onUpdate, onManageModels: vi.fn() };
    const { rerender } = render(<SessionSettingsPanel {...props} settings={{ status: 'ready', value: confirmed }} />);
    await user.click(screen.getByRole('button', { name: 'Spec drafting…' }));
    await user.click(screen.getByRole('button', { name: 'Use session model' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ field: 'specModeModelId', value: null });
    expect(screen.getByRole('combobox', { name: 'Spec model' }).textContent).toBe('Draft model');
    rerender(<SessionSettingsPanel {...props} disabled settings={{ status: 'updating', value: confirmed }} />);
    expect(screen.getByRole('button', { name: 'Use model default' }).hasAttribute('disabled')).toBe(true);
    rerender(<SessionSettingsPanel {...props} settings={{ status: 'error', value: confirmed, message: 'Drafting model rejected' }} />);
    expect(screen.getByRole('alert').textContent).toBe('Drafting model rejected');
    expect(screen.getByRole('combobox', { name: 'Spec model' }).textContent).toBe('Draft model');
    await user.click(screen.getByRole('button', { name: 'Use model default' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ field: 'specModeReasoningEffort', value: null });
    rerender(<SessionSettingsPanel {...props} settings={{ status: 'ready', value: { ...confirmed, specModeModelId: null, specModeReasoningEffort: null } }} />);
    expect(screen.getByRole('combobox', { name: 'Spec model' }).textContent).toBe('Same as session');
    expect(screen.getByRole('combobox', { name: 'Spec reasoning' }).textContent).toBe('Model default');
  });

  it('adds a parsed MCP command without submitting the enclosing composer, including during IME input', async () => {
    const user = userEvent.setup();
    const actions = { onRefresh: vi.fn(), onToggle: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onAuthenticate: vi.fn() };
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><McpPanel mcp={{ status: 'ready', items: [] }} auth={null} disabled={false} {...actions} /></form>);
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    await user.type(screen.getByRole('textbox', { name: 'Server name' }), ' docs ');
    await user.type(screen.getByRole('textbox', { name: 'Command' }), ' server-tool  --read-only ');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Command' }), { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(actions.onAdd).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Command' }), { key: 'Enter' });
    expect(actions.onAdd).toHaveBeenCalledExactlyOnceWith({ name: 'docs', serverType: 'stdio', command: 'server-tool', args: ['--read-only'] });
    expect(submit).not.toHaveBeenCalled();
  });

  it('requires a second removal click and waits for the MCP catalog response', async () => {
    const user = userEvent.setup();
    const mcp: McpPanelState = {
      status: 'ready',
      items: [{ name: 'docs', status: 'connected', toolCount: 0, requiresAuth: false, hasAuthTokens: false, tools: [] }],
    };
    const actions = { onRefresh: vi.fn(), onToggle: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onAuthenticate: vi.fn() };
    const { rerender } = render(<McpPanel mcp={mcp} auth={null} disabled={false} {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Remove docs' }));
    expect(actions.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm remove docs' }));
    expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith('docs');
    expect(screen.getByRole('button', { name: 'Remove docs' }).hasAttribute('disabled')).toBe(true);
    rerender(<McpPanel mcp={{ ...mcp, status: 'error', message: 'Server removal failed' }} auth={null} disabled={false} {...actions} />);
    expect(screen.getByRole('alert').textContent).toBe('Server removal failed');
    expect(screen.getByRole('button', { name: 'Remove docs' }).hasAttribute('disabled')).toBe(false);
  });

  it('blocks setting changes during a permission request but preserves compaction and theme controls', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialAssistantWebviewState, sessionId: 'session', connection: { status: 'connected' as const },
      settings: { status: 'ready' as const, value: confirmed }, modelCatalog: catalog,
      context: { status: 'ready' as const, value: { availability: 'unavailable' as const, reason: 'awaiting-usage' as const } },
      interactions: [{ sessionId: 'session', turnId: 'turn', request: { kind: 'permission' as const, requestId: 'request', tools: [], options: [] } }],
    };
    const props = {
      state, port: { postMessage: vi.fn() }, blocked: false, onPageChange: vi.fn(),
      onCompact: vi.fn(), compactPending: false, onNewSession: vi.fn(),
      theme: { preference: 'auto' as const, resolved: 'dark' as const, onPreferenceChange: vi.fn() },
    };
    const { rerender } = render(<SettingsMenu {...props} page="settings" />);
    expect(screen.getByRole('combobox', { name: 'Model' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Theme' }).hasAttribute('disabled')).toBe(false);
    rerender(<SettingsMenu {...props} page="context" />);
    await user.click(screen.getByRole('button', { name: 'Compact conversation' }));
    expect(props.onCompact).toHaveBeenCalledOnce();
    rerender(<SettingsMenu {...props} page="context" compactPending />);
    expect(screen.getByRole('button', { name: 'Compacting…' }).hasAttribute('disabled')).toBe(true);
  });
});
