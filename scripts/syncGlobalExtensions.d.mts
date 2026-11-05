export function syncGlobalExtensions(options?: {
  repoRoot?: string;
  home?: string;
  mode?: 'all' | 'webview' | 'extension';
  dryRun?: boolean;
}): Array<{ editor: string; directory: string; changedFiles: number }>;
