export function resolveBrowserDevSourceRoot(
  configuredSourceRoot: string | undefined,
  developmentSourceRoot: string | null,
): string | null {
  const configured = configuredSourceRoot?.trim();
  return configured === undefined || configured.length === 0
    ? developmentSourceRoot
    : configured;
}
