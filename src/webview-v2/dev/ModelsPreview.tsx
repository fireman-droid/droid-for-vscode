import { useMemo, useState } from 'react';
import { createModelsPreviewTransport } from './modelsPreviewTransport';
import { ModelsApp } from '../models/ModelsApp';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/selection';

export function ModelsPreview() {
  const preview = useMemo(createModelsPreviewTransport, []);
  const [failed, setFailed] = useState(false);
  return <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
    <aside className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs">
      <span>Models preview · simulated only</span>
      <Button variant="outline" size="sm" onClick={() => { preview.failSave(); setFailed(true); }}>{failed ? 'Next save will fail' : 'Fail next save'}</Button>
      <label className="flex items-center gap-1"><Checkbox onCheckedChange={(checked) => preview.busy(checked === true)} />Chat busy</label>
    </aside>
    <ModelsApp transport={preview.transport} />
  </div>;
}
