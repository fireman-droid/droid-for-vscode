import { ConnectionForm, ModelForm, PROTOCOLS } from './ModelForms';
import type { ModelsTransport } from './useModels';
import { operationLabel, useModelsPage } from './useModelsPage';

export function ModelsApp({
  transport,
}: {
  transport: ModelsTransport;
}): React.JSX.Element {
  const {
    manager, connectionForm, modelForm, search, chosen, connection, busy, editing, models, visible, discovered,
    setSelectedId, setConnectionForm, setModelForm, setSearch, setDiscovery, setChosen,
    saveConnection, saveModel, discoverModels, importModels,
  } = useModelsPage(transport);
  const { snapshot, pending, notice, run } = manager;

  return (
    <main className="dvx-shell mm-shell" data-theme={manager.theme}>
      <header className="mm-topbar">
        <div>
          <h1>Models</h1>
          <p>Connections and models in Droid settings</p>
        </div>
        <button disabled={busy || editing} onClick={() => void run({ kind: 'refresh' })}>
          {pending === 'refresh' ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      <div className="mm-layout">
        <nav className="mm-connections" aria-label="Model connections">
          <div className="mm-section-label">
            Connections <span>{snapshot?.connections.length ?? 0}</span>
          </div>
          {snapshot?.connections.map((item) => (
            <button
              key={item.id}
              aria-current={item.id === connection?.id ? 'page' : undefined}
              disabled={busy || editing}
              onClick={() => {
                setSelectedId(item.id);
                setSearch('');
                setDiscovery(null);
              }}
            >
              <span>{item.name}</span>
              <small>{PROTOCOLS[item.protocol].name}</small>
            </button>
          ))}
          <button
            className="mm-add-connection"
            disabled={busy || editing}
            onClick={() => setConnectionForm({ connection: null })}
          >
            + New connection
          </button>
          <p className="mm-sidebar-note">
            Existing settings.json models appear here automatically. Other provider types
            stay managed in Droid settings.
          </p>
        </nav>
        <section className="mm-content" aria-label="Connection details" aria-busy={busy}>
          {notice !== null ? (
            <p
              className={`mm-notice${notice.ok ? '' : ' mm-error'}`}
              role={notice.ok ? 'status' : 'alert'}
            >
              {notice.message}
            </p>
          ) : null}
          {busy && pending !== 'refresh' ? (
            <div className="mm-pending" role="status">
              <span>{operationLabel(pending)}</span>
              <button onClick={manager.cancel}>Cancel operation</button>
            </div>
          ) : null}
          {connectionForm !== null ? (
            <ConnectionForm
              key={connectionForm.connection?.id ?? 'new'}
              connection={connectionForm.connection}
              busy={busy}
              onCancel={() => setConnectionForm(null)}
              onSave={(draft) => void saveConnection(draft)}
            />
          ) : snapshot === null ? (
            <div className="mm-empty">
              <h2>{busy ? 'Reading Droid settings…' : 'Model catalog unavailable'}</h2>
              <p>
                {busy
                  ? 'Waiting for the local Droid daemon.'
                  : 'Refresh to retry. Sign in with the Droid CLI if needed.'}
              </p>
            </div>
          ) : connection === null ? (
            <div className="mm-empty">
              <h2>Connect your model provider</h2>
              <p>
                Add a compatible endpoint, then discover its Model IDs or enter one
                manually.
              </p>
              <button
                className="mm-primary"
                onClick={() => setConnectionForm({ connection: null })}
              >
                New connection
              </button>
            </div>
          ) : (
            <>
              <header className="mm-connection-heading">
                <div>
                  <h2>{connection.name}</h2>
                  <p>
                    {connection.imported
                      ? 'Imported from Droid settings'
                      : 'Managed connection'}
                  </p>
                </div>
                <button
                  disabled={busy || editing}
                  onClick={() => setConnectionForm({ connection })}
                >
                  Edit connection
                </button>
              </header>
              <dl className="mm-connection-meta">
                <div>
                  <dt>Protocol</dt>
                  <dd>{PROTOCOLS[connection.protocol].name}</dd>
                </div>
                <div>
                  <dt>Base URL</dt>
                  <dd>
                    <code>{connection.baseUrl}</code>
                  </dd>
                </div>
                <div>
                  <dt>API route</dt>
                  <dd>
                    <code>{PROTOCOLS[connection.protocol].route}</code>
                    <span className="mm-optional">
                      {' '}
                      · protocol route, not a captured request
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>API key</dt>
                  <dd>{connection.hasKey ? 'Configured' : 'Not set (keyless)'}</dd>
                </div>
              </dl>
              <div className="mm-model-toolbar">
                <h3>
                  Models <span>{models.length}</span>
                </h3>
                <div className="mm-actions">
                  <button
                    disabled={busy || editing}
                    onClick={() => setModelForm({ model: null })}
                  >
                    Add manually
                  </button>
                  <button
                    className="mm-primary"
                    disabled={busy || editing}
                    onClick={() => void discoverModels(connection.id)}
                  >
                    Discover models
                  </button>
                </div>
              </div>
              {modelForm !== null ? (
                <ModelForm
                  key={modelForm.model?.rawIndex ?? 'new'}
                  model={modelForm.model}
                  connection={connection}
                  busy={busy}
                  onSave={(draft, verify) => void saveModel(draft, verify)}
                  onCancel={() => setModelForm(null)}
                />
              ) : null}
              {discovered !== null && !editing ? (
                <section className="mm-discovery" aria-label="Discovered models">
                  <header>
                    <h3>Provider returned {discovered.length} models</h3>
                    <button disabled={busy} onClick={() => setDiscovery(null)}>
                      Close
                    </button>
                  </header>
                  <p>Select exact IDs to add. Existing IDs are skipped.</p>
                  <div className="mm-discovered-list">
                    {discovered.map((item) => {
                      const exists = models.some((row) => row.model === item.model);
                      return (
                        <label className="mm-check" key={item.model}>
                          <input
                            type="checkbox"
                            disabled={
                              busy ||
                              exists ||
                              (!chosen.has(item.model) && chosen.size >= 100)
                            }
                            checked={exists || chosen.has(item.model)}
                            onChange={(event) => {
                              const next = new Set(chosen);
                              if (event.target.checked) next.add(item.model);
                              else next.delete(item.model);
                              setChosen(next);
                            }}
                          />
                          <code>{item.model}</code>
                          {exists ? <small>Added</small> : null}
                        </label>
                      );
                    })}
                  </div>
                  <button
                    className="mm-primary"
                    disabled={busy || chosen.size === 0}
                    onClick={() => void importModels(connection.id, discovered)}
                  >
                    Add selected ({chosen.size})
                  </button>
                </section>
              ) : null}
              <label className="mm-search">
                <span className="mm-sr-only">Search models</span>
                <input
                  type="search"
                  placeholder="Search Model ID or display name…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="mm-model-list" aria-label="Configured models">
                {visible.map((model) => (
                  <article
                    className="mm-model-row"
                    key={`${model.rawIndex}:${model.model}`}
                  >
                    <div className="mm-model-copy">
                      <h4>{model.displayName}</h4>
                      <code>{model.model}</code>
                      <p className="mm-model-status" title={model.loadMessage}>
                        Saved ·{' '}
                        {model.runtimeId === null ? 'Not loaded' : 'Loaded by Droid'}
                        {' · '}
                        {model.test === null
                          ? 'Not verified'
                          : model.test.status === 'passed'
                            ? 'Verified this window'
                            : 'Verification failed'}
                        {snapshot.activeModelId === model.runtimeId &&
                        model.runtimeId !== null
                          ? ' · Current chat'
                          : ''}
                      </p>
                      {model.runtimeId === null ? (
                        <p className="mm-help">{model.loadMessage}</p>
                      ) : null}
                      {model.test !== null ? (
                        <p
                          className={
                            model.test.status === 'failed' ? 'mm-error' : 'mm-help'
                          }
                        >
                          {model.test.message} ({(model.test.latencyMs / 1000).toFixed(1)}
                          s)
                        </p>
                      ) : null}
                    </div>
                    <div className="mm-row-actions">
                      <button
                        disabled={
                          busy ||
                          editing ||
                          model.runtimeId === null ||
                          !snapshot.canApply
                        }
                        title={snapshot.applyMessage}
                        onClick={() =>
                          void run({
                            kind: 'useModel',
                            rawIndex: model.rawIndex,
                            expectedModel: model.model,
                          })
                        }
                      >
                        Use in chat
                      </button>
                      <button
                        disabled={busy || editing || model.runtimeId === null}
                        onClick={() =>
                          void run({
                            kind: 'verifyModel',
                            rawIndex: model.rawIndex,
                            expectedModel: model.model,
                          })
                        }
                      >
                        Verify…
                      </button>
                      <button
                        disabled={busy || editing}
                        onClick={() => setModelForm({ model })}
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy || editing}
                        aria-label={`Delete ${model.model}`}
                        onClick={() =>
                          void run({
                            kind: 'deleteModel',
                            rawIndex: model.rawIndex,
                            expectedModel: model.model,
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
                {visible.length === 0 ? (
                  <p className="mm-list-empty">
                    {models.length === 0
                      ? 'No models on this connection yet. Discover models or add an exact Model ID.'
                      : 'No models match this search.'}
                  </p>
                ) : null}
              </div>
              <footer className="mm-footer">
                <p>{snapshot.applyMessage} Refresh updates this status.</p>
                {models.length === 0 ? (
                  <button
                    disabled={busy || editing}
                    onClick={() =>
                      void run({ kind: 'deleteConnection', connectionId: connection.id })
                    }
                  >
                    Remove empty connection
                  </button>
                ) : null}
              </footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

