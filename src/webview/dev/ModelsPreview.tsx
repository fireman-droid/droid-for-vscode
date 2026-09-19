import { useMemo, useState } from 'react';
import { ModelsApp } from '../models/ModelsApp';
import { createModelsPreviewTransport } from './modelsPreviewTransport';
import '../models/models.css';

export { createModelsPreviewTransport } from './modelsPreviewTransport';

export function ModelsPreview(): React.JSX.Element {
  const preview = useMemo(createModelsPreviewTransport, []);
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          padding: '8px 16px',
          font: '12px system-ui',
          background: '#e8e5df',
          color: '#292929',
        }}
      >
        <span>Models preview · simulated only</span>
        <button
          onClick={() => {
            preview.failSave();
            setFailed(true);
          }}
        >
          {failed ? 'Next save will fail' : 'Fail next save'}
        </button>
        <label>
          <input
            type="checkbox"
            onChange={(event) => preview.busy(event.target.checked)}
          />
          Chat busy
        </label>
        <label>
          <input
            type="checkbox"
            onChange={(event) => preview.theme(event.target.checked ? 'dark' : 'light')}
          />
          Dark theme
        </label>
      </div>
      <div style={{ minHeight: 0, flex: 1 }}>
        <ModelsApp transport={preview.transport} />
      </div>
    </div>
  );
}
