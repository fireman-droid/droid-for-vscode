import { useEffect } from 'react';
import { useMissionCatalog } from './useMissionCatalog';
import { applyTheme } from '../shell/theme';
import { MissionCatalog } from './MissionCatalog';

export function MissionControlApp({ vscode }: { readonly vscode: { postMessage(message: unknown): void } }) {
  const flow = useMissionCatalog(vscode);
  useEffect(() => { if (flow.theme) applyTheme(flow.theme.preference, flow.theme.resolved); }, [flow.theme]);
  return <div className="h-full overflow-x-hidden overflow-y-auto"><MissionCatalog {...flow} /></div>;
}
