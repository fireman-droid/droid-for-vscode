import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  CUSTOM_MODEL_PROVIDERS,
  IDLE_CUSTOM_MODELS_STATE,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  MAX_CUSTOM_MODEL_OUTPUT_TOKENS,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  mergeCustomModelsState,
  parseCustomModelsStateMessage,
  type CustomModelListItem,
  type CustomModelProvider,
  type CustomModelSaveMessage,
  type CustomModelsUiState,
} from '../../shared/customModelsProtocol';
import {
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';

/**
 * BYOK custom-model management
 * (docs/product/byok-add-model-design.md §4-§5.3): the ModelPopover's
 * "Add model…" entry opens this panel; list/save/delete round-trips
 * run through the daemon on the host side. All Bridge traffic flows
 * through context callbacks that App wires up — same pattern as
 * GitCommitFlowContext — so no props thread through Thread/Composer.
 *
 * Credential red line: this module renders daemon-masked key values
 * only, never plaintext. The form's key field is component-local
 * state that dies with the panel; it is never persisted into drafts
 * or `vscode.setState`, and an untouched key field on edit means
 * "keep the stored key" (probed daemon semantics).
 */

/** Save payload; App stamps `type` and `sessionId`. */
export type CustomModelSaveParams = Omit<
  CustomModelSaveMessage,
  'type' | 'sessionId'
>;

export interface CustomModelsFlowValue {
  readonly customModels: CustomModelsUiState;
  readonly onRefresh: () => void;
  readonly onSave: (params: CustomModelSaveParams) => void;
  readonly onDelete: (rawIndex: number, expectedModel: string) => void;
}

export const CustomModelsContext =
  createContext<CustomModelsFlowValue | null>(null);

interface CustomModelsPort {
  postMessage(message: WebviewToHostMessage): void;
}

/**
 * App-level flow state for the panel. `customModels.state` bypasses
 * the session store (like `ui.theme`): the state is pulled on demand
 * while the panel is open and must not sit in long-lived snapshots,
 * so this hook keeps it locally and validates the host push with the
 * same shared parser the bridge validator delegates to. Messages are
 * dropped unless they target the current session, and a session
 * switch resets to idle (the panel re-pulls on entry).
 */
export function useCustomModelsFlow(
  vscode: CustomModelsPort,
  sessionId: string | null,
): CustomModelsFlowValue {
  const [customModels, setCustomModels] = useState<CustomModelsUiState>(
    IDLE_CUSTOM_MODELS_STATE,
  );
  useEffect(() => {
    setCustomModels(IDLE_CUSTOM_MODELS_STATE);
    if (sessionId === null) {
      return;
    }
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const message = parseCustomModelsStateMessage(event.data);
      if (message === null || message.sessionId !== sessionId) {
        return;
      }
      setCustomModels((previous) =>
        mergeCustomModelsState(previous, message.customModels),
      );
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId]);
  return useMemo(
    () => ({
      customModels,
      onRefresh: () => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'customModels.refresh', sessionId });
        }
      },
      onSave: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'customModels.save',
            sessionId,
            ...params,
          });
        }
      },
      onDelete: (rawIndex, expectedModel) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'customModels.delete',
            sessionId,
            rawIndex,
            expectedModel,
          });
        }
      },
    }),
    [customModels, sessionId, vscode],
  );
}

/**
 * Quiet fixed row at the tail of the ModelPopover. Re-reads the list
 * on entry (same convention as the Skills/MCP link rows) so the panel
 * reflects edits made from the CLI or settings.json meanwhile.
 */
export function AddModelEntry({
  onOpen,
}: {
  readonly onOpen: () => void;
}): React.JSX.Element | null {
  const flow = useContext(CustomModelsContext);
  if (flow === null) {
    return null;
  }
  return (
    <button
      type="button"
      className="dvx-popover-row dvx-cm-add-entry"
      onClick={() => {
        flow.onRefresh();
        onOpen();
      }}
    >
      <span className="dvx-cm-add-plus" aria-hidden="true">
        +
      </span>
      <span className="dvx-popover-row-copy">
        <strong>Add model…</strong>
      </span>
    </button>
  );
}

type PanelView =
  | { readonly mode: 'list' }
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly item: CustomModelListItem };

export function CustomModelsPanel({
  id,
  onBack,
}: {
  readonly id: string;
  readonly onBack: () => void;
}): React.JSX.Element | null {
  const flow = useContext(CustomModelsContext);
  const [view, setView] = useState<PanelView>({ mode: 'list' });
  // Shown once the user changed something: models enter the picker
  // via a session (re)load, which the host performs only when idle.
  const [mutated, setMutated] = useState(false);
  const state = flow?.customModels ?? IDLE_CUSTOM_MODELS_STATE;
  // Session-switch recovery, mirroring the MCP panel: an idle state
  // under a visible panel means nobody re-pulled after the reset.
  const refresh = flow?.onRefresh;
  useEffect(() => {
    if (state.status === 'idle' && refresh !== undefined) {
      refresh();
    }
  }, [state.status, refresh]);
  if (flow === null) {
    return null;
  }
  const busy = state.status === 'loading' || state.status === 'idle';
  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-cm-popover"
      role="dialog"
      aria-label="Custom models"
    >
      <div className="dvx-panel-head">
        <button
          type="button"
          className="dvx-panel-back"
          aria-label="Back to model list"
          onClick={() =>
            view.mode === 'list' ? onBack() : setView({ mode: 'list' })
          }
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">
            {view.mode === 'list'
              ? 'Custom models'
              : view.mode === 'create'
                ? 'Add model'
                : 'Edit model'}
          </span>
        </button>
        {view.mode === 'list' ? (
          <div className="dvx-panel-actions">
            <button
              type="button"
              className="dvx-panel-action"
              disabled={busy || state.status === 'unavailable'}
              onClick={() => setView({ mode: 'create' })}
            >
              Add
            </button>
            <button
              type="button"
              className="dvx-panel-action"
              disabled={state.status === 'loading'}
              onClick={flow.onRefresh}
            >
              Refresh
            </button>
          </div>
        ) : null}
      </div>
      {view.mode === 'list' ? (
        <CustomModelsList
          state={state}
          busy={busy}
          mutated={mutated}
          onEdit={(item) => setView({ mode: 'edit', item })}
          onDelete={(item) => {
            setMutated(true);
            flow.onDelete(item.rawIndex, item.model);
          }}
        />
      ) : (
        <CustomModelForm
          item={view.mode === 'edit' ? view.item : null}
          busy={busy}
          onCancel={() => setView({ mode: 'list' })}
          onSave={(params) => {
            setMutated(true);
            setView({ mode: 'list' });
            flow.onSave(params);
          }}
        />
      )}
    </div>
  );
}

function CustomModelsList({
  state,
  busy,
  mutated,
  onEdit,
  onDelete,
}: {
  readonly state: CustomModelsUiState;
  readonly busy: boolean;
  readonly mutated: boolean;
  readonly onEdit: (item: CustomModelListItem) => void;
  readonly onDelete: (item: CustomModelListItem) => void;
}): React.JSX.Element {
  // Two-step destructive confirm, keyed by rawIndex (MCP pattern);
  // a stray click must not leave the confirm armed.
  const [confirming, setConfirming] = useState<number | null>(null);
  useEffect(() => {
    if (confirming === null) {
      return;
    }
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  return (
    <>
      {state.status === 'error' || state.status === 'unavailable' ? (
        <p
          className={`dvx-popover-message ${
            state.status === 'error' ? 'dvx-error-text' : ''
          }`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}
      {busy && state.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          Loading custom models…
        </p>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          No custom models configured yet.
        </p>
      ) : null}
      {state.items.length > 0 ? (
        <ul className="dvx-cm-list" aria-label="Custom models">
          {state.items.map((item) => (
            <li key={item.rawIndex} className="dvx-cm-row">
              <span className="dvx-cm-copy">
                <span className="dvx-cm-name">
                  {item.displayName ?? item.model}
                  {item.hasBedrockConfig ? (
                    <span className="dvx-cm-badge">Bedrock</span>
                  ) : null}
                  {!item.isValid ? (
                    <span className="dvx-cm-badge dvx-cm-badge-warn">
                      Invalid
                    </span>
                  ) : null}
                </span>
                <span className="dvx-cm-meta">
                  {item.model} · {item.provider}
                  {item.baseUrl !== undefined ? ` · ${item.baseUrl}` : ''}
                </span>
              </span>
              <span className="dvx-cm-key" title="API key">
                {item.hasApiKey ? (item.apiKeyMask ?? 'key set') : 'no key'}
              </span>
              <span className="dvx-cm-actions">
                <button
                  type="button"
                  className="dvx-cm-action"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`dvx-cm-action dvx-cm-delete${
                    confirming === item.rawIndex
                      ? ' dvx-cm-delete-confirm'
                      : ''
                  }`}
                  disabled={busy}
                  onClick={() => {
                    if (confirming === item.rawIndex) {
                      setConfirming(null);
                      onDelete(item);
                    } else {
                      setConfirming(item.rawIndex);
                    }
                  }}
                >
                  {confirming === item.rawIndex ? 'Confirm?' : 'Delete'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {confirming !== null ? (
        <p className="dvx-popover-message" role="status">
          Deleting shifts the custom: ids of the models below it;
          favorites and default-model references may need re-picking.
        </p>
      ) : null}
      {mutated && state.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Changes reach the model picker when the session reloads; busy
          sessions pick them up on the next reload.
        </p>
      ) : null}
    </>
  );
}

const PROVIDER_LABELS: Record<CustomModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'generic-chat-completion-api': 'Generic',
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Deliberately NOT a `<form>` (MCP add-form lesson): this card lives
 * inside the assistant-ui composer `<form>`, and a nested form's
 * native submit would navigate the whole webview away. Submission is
 * a plain click with a disabled-gate; Enter on the inputs submits and
 * `preventDefault` keeps it from reaching the outer composer form.
 */
function CustomModelForm({
  item,
  busy,
  onCancel,
  onSave,
}: {
  /** Null = create; an item = edit with its concurrency guard. */
  readonly item: CustomModelListItem | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (params: CustomModelSaveParams) => void;
}): React.JSX.Element {
  const [model, setModel] = useState(item?.model ?? '');
  const [displayName, setDisplayName] = useState(item?.displayName ?? '');
  const [baseUrl, setBaseUrl] = useState(item?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const initialProvider = item?.provider;
  const [provider, setProvider] = useState<CustomModelProvider>(
    isFormProvider(initialProvider) ? initialProvider : 'openai',
  );
  const [maxTokens, setMaxTokens] = useState(
    item?.maxOutputTokens === undefined ? '' : String(item.maxOutputTokens),
  );
  const [noImageSupport, setNoImageSupport] = useState(
    item?.noImageSupport === true,
  );

  const trimmedModel = model.trim();
  const trimmedName = displayName.trim();
  const trimmedUrl = baseUrl.trim();
  const trimmedKey = apiKey.trim();
  const modelValid =
    trimmedModel.length > 0 &&
    trimmedModel.length <= MAX_MODEL_ID_LENGTH &&
    !CONTROL_CHARS.test(trimmedModel);
  const urlValid =
    /^https?:\/\/./.test(trimmedUrl) &&
    !/\s/.test(trimmedUrl) &&
    trimmedUrl.length <= MAX_CUSTOM_MODEL_URL_LENGTH;
  const nameValid =
    trimmedName.length <= MAX_MODEL_DISPLAY_NAME_LENGTH &&
    !CONTROL_CHARS.test(trimmedName);
  const keyValid =
    trimmedKey.length <= MAX_CUSTOM_MODEL_KEY_LENGTH &&
    !CONTROL_CHARS.test(trimmedKey);
  const tokens = maxTokens.trim();
  const tokensNumber = Number(tokens);
  const tokensValid =
    tokens.length === 0 ||
    (Number.isSafeInteger(tokensNumber) &&
      tokensNumber >= 1 &&
      tokensNumber <= MAX_CUSTOM_MODEL_OUTPUT_TOKENS);
  const canSave =
    !busy && modelValid && urlValid && nameValid && keyValid && tokensValid;
  // Quiet gate: empty required fields just keep Save disabled; a
  // filled but malformed value earns the one hint explaining it.
  const hint = !urlValid && trimmedUrl.length > 0
    ? 'Enter a base URL starting with http:// or https://.'
    : !tokensValid
      ? 'Max output tokens must be a positive whole number.'
      : null;

  const submit = (): void => {
    if (!canSave) {
      return;
    }
    onSave({
      ...(item === null
        ? {}
        : { rawIndex: item.rawIndex, expectedModel: item.model }),
      model: trimmedModel,
      ...(trimmedName.length > 0 ? { displayName: trimmedName } : {}),
      provider,
      baseUrl: trimmedUrl,
      // Blank on edit = keep the stored key (probed); blank on create
      // = keyless endpoint. Either way the field never echoes back.
      ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
      maxOutputTokens: tokens.length === 0 ? null : tokensNumber,
      noImageSupport,
    });
  };
  const submitOnEnter = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="dvx-cm-form" role="form" aria-label="Custom model">
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">Model ID *</span>
        <input
          className="dvx-mcp-add-input"
          type="text"
          placeholder="e.g. qwen3:4b or claude-sonnet-4-5"
          value={model}
          maxLength={MAX_MODEL_ID_LENGTH}
          autoComplete="off"
          onChange={(event) => setModel(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">Display name</span>
        <input
          className="dvx-mcp-add-input"
          type="text"
          placeholder="Shown in the model picker"
          value={displayName}
          maxLength={MAX_MODEL_DISPLAY_NAME_LENGTH}
          autoComplete="off"
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <div
        className="dvx-cm-field"
        role="radiogroup"
        aria-label="Provider"
      >
        <span className="dvx-cm-field-label">Provider *</span>
        <div className="dvx-mcp-add-types">
          {CUSTOM_MODEL_PROVIDERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="dvx-mcp-add-type"
              aria-checked={provider === value}
              onClick={() => setProvider(value)}
            >
              {PROVIDER_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">Base URL *</span>
        <input
          className="dvx-mcp-add-input"
          type="text"
          placeholder="e.g. http://localhost:11434/v1"
          value={baseUrl}
          maxLength={MAX_CUSTOM_MODEL_URL_LENGTH}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">API key</span>
        <input
          className="dvx-mcp-add-input"
          type="password"
          placeholder={
            item !== null && item.hasApiKey
              ? `${item.apiKeyMask ?? 'key set'} — leave blank to keep`
              : 'sk-… or ${VAR_NAME}; blank for keyless'
          }
          value={apiKey}
          maxLength={MAX_CUSTOM_MODEL_KEY_LENGTH}
          autoComplete="off"
          onChange={(event) => setApiKey(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <div className="dvx-cm-field-row">
        <label className="dvx-cm-field">
          <span className="dvx-cm-field-label">Max output tokens</span>
          <input
            className="dvx-mcp-add-input"
            type="text"
            inputMode="numeric"
            placeholder="Model default"
            value={maxTokens}
            maxLength={12}
            autoComplete="off"
            onChange={(event) => setMaxTokens(event.currentTarget.value)}
            onKeyDown={submitOnEnter}
          />
        </label>
        <label className="dvx-cm-check">
          <input
            type="checkbox"
            checked={noImageSupport}
            onChange={(event) =>
              setNoImageSupport(event.currentTarget.checked)
            }
          />
          <span>No image input</span>
        </label>
      </div>
      {hint !== null ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {hint}
        </p>
      ) : null}
      {item !== null && item.hasBedrockConfig ? (
        <p className="dvx-popover-message" role="status">
          Bedrock and other advanced fields stay as configured in
          settings.json (verified against the local daemon).
        </p>
      ) : null}
      <div className="dvx-cm-form-actions">
        <button
          type="button"
          className="dvx-mcp-add-submit"
          disabled={!canSave}
          onClick={submit}
        >
          {item === null ? 'Add model' : 'Save changes'}
        </button>
        <button
          type="button"
          className="dvx-cm-action"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function isFormProvider(
  value: string | undefined,
): value is CustomModelProvider {
  return (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(
    value ?? '',
  );
}

function ChevronLeftIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-chevron-left"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m9.5 4.5-3.5 3.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
