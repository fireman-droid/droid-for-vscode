/**
 * Webview-local cache of data URLs for images staged from the
 * composer (drop or paste). The host only echoes attachment metadata
 * back over the Bridge, so thumbnails come from the bytes the webview
 * already read; entries are keyed by the (name, size) pair that the
 * host summary reports. Images staged host-side (file picker) never
 * enter this cache and fall back to the text chip.
 */

const MAX_PREVIEW_ENTRIES = 24;

const previews = new Map<string, string>();

function previewKey(name: string, sizeBytes: number): string {
  return `${sizeBytes}\u0000${name}`;
}

export function rememberImagePreview(
  name: string,
  sizeBytes: number,
  dataUrl: string,
): void {
  const key = previewKey(name, sizeBytes);
  // Re-insert to refresh recency before size-based eviction.
  previews.delete(key);
  previews.set(key, dataUrl);
  while (previews.size > MAX_PREVIEW_ENTRIES) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    previews.delete(oldest);
  }
}

export function getImagePreview(name: string, sizeBytes: number): string | undefined {
  return previews.get(previewKey(name, sizeBytes));
}

/** Test-only reset so cases stay independent. */
export function clearImagePreviews(): void {
  previews.clear();
}
