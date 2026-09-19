import { useState } from 'react';
import type { CustomModelProvider } from '../../shared/protocol/customModelsProtocol';
import { MAX_CUSTOM_MODEL_OUTPUT_TOKENS } from '../../shared/protocol/customModelsProtocol';
import { PROTOCOLS } from './protocols';
export { PROTOCOLS } from './protocols';
import type {
  ConnectionDraft,
  ManagedModel,
  ManagedModelDraft,
  ModelConnection,
} from '../../shared/protocol/modelManagerProtocol';

export function ConnectionForm({
  connection,
  busy,
  onSave,
  onCancel,
}: {
  connection: ModelConnection | null;
  busy: boolean;
  onSave: (draft: ConnectionDraft) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(connection?.name ?? '');
  const [protocol, setProtocol] = useState<CustomModelProvider>(
    connection?.protocol ?? 'generic-chat-completion-api',
  );
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [setApiKey, setSetApiKey] = useState(false);
  return (
    <form
      className="mm-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...(connection === null ? {} : { id: connection.id }),
          name: name.trim(),
          protocol,
          baseUrl: baseUrl.trim(),
          setApiKey,
        });
      }}
    >
      <header>
        <h2>{connection === null ? 'New connection' : 'Edit connection'}</h2>
        <p>One endpoint, shared by its models.</p>
      </header>
      <fieldset disabled={busy}>
        <label>
          Connection name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            placeholder="My gateway"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Protocol
          <select
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as CustomModelProvider)}
          >
            {Object.entries(PROTOCOLS).map(([id, info]) => (
              <option key={id} value={id}>
                {info.name}
              </option>
            ))}
          </select>
          <small>{PROTOCOLS[protocol].hint}</small>
        </label>
        <label>
          Base URL
          <input
            required
            type="url"
            maxLength={2048}
            value={baseUrl}
            placeholder="https://gateway.example.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <small>
            Use the provider’s full API base, including its path. Do not paste a key or
            the final request route.
          </small>
        </label>
        <label className="mm-check">
          <input
            type="checkbox"
            checked={setApiKey}
            onChange={(event) => setSetApiKey(event.target.checked)}
          />
          {connection?.hasKey ? 'Replace API key on save' : 'Enter API key on save'}
        </label>
        <p className="mm-help">
          The key is entered in Cursor’s password prompt, never in this page. Droid stores
          model credentials in its settings. Leave unchecked for a keyless endpoint.
        </p>
        {connection?.imported ? (
          <p className="mm-help">
            Existing models come from Droid settings. Re-enter the key once to reuse it
            for discovery and new models.
          </p>
        ) : null}
        <div className="mm-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="mm-primary" type="submit">
            {busy ? 'Saving…' : 'Save connection'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function ModelForm({
  model,
  connection,
  busy,
  onSave,
  onCancel,
}: {
  model: ManagedModel | null;
  connection: ModelConnection;
  busy: boolean;
  onSave: (draft: ManagedModelDraft, verify: boolean) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [id, setId] = useState(model?.model ?? '');
  const [name, setName] = useState(model?.displayName ?? '');
  const [tokens, setTokens] = useState(model?.maxOutputTokens?.toString() ?? '');
  const [noImages, setNoImages] = useState(model?.noImageSupport ?? false);
  return (
    <form
      className="mm-form mm-model-form"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        onSave(
          {
            connectionId: connection.id,
            ...(model === null
              ? {}
              : { rawIndex: model.rawIndex, expectedModel: model.model }),
            model: id.trim(),
            displayName: name.trim(),
            maxOutputTokens: tokens === '' ? null : Number(tokens),
            noImageSupport: noImages,
          },
          submitter?.getAttribute('value') === 'verify',
        );
      }}
    >
      <header>
        <h2>{model === null ? 'Add a model manually' : 'Edit model'}</h2>
        <p>
          Use the exact Model ID returned by {connection.name}. A display name does not
          change the upstream model.
        </p>
      </header>
      <fieldset disabled={busy}>
        <label>
          Model ID
          <input
            required
            autoFocus
            maxLength={256}
            value={id}
            placeholder="Exact upstream model identifier"
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <label>
          Display name <span className="mm-optional">optional</span>
          <input
            maxLength={160}
            value={name}
            placeholder="Defaults to Model ID · connection"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Maximum output tokens <span className="mm-optional">optional</span>
          <input
            type="number"
            min={1}
            max={MAX_CUSTOM_MODEL_OUTPUT_TOKENS}
            step={1}
            value={tokens}
            placeholder="Droid default"
            onChange={(event) => setTokens(event.target.value)}
          />
        </label>
        <label className="mm-check">
          <input
            type="checkbox"
            checked={noImages}
            onChange={(event) => setNoImages(event.target.checked)}
          />
          Text-only model (no image input)
        </label>
        <div className="mm-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" value="verify">
            Save &amp; verify…
          </button>
          <button type="submit" className="mm-primary">
            Save model
          </button>
        </div>
      </fieldset>
    </form>
  );
}
