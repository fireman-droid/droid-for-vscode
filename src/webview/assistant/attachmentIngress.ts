import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_REMOTE_URL_LENGTH,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_ATTACHMENT_URI_LENGTH,
  type ImageMediaType,
} from "../../shared/bridgeMessages";

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

export function readDroppedFileUris(
  dataTransfer: Pick<DataTransfer, "getData">,
): readonly string[] {
  const plain = dataTransfer.getData("text/uri-list");
  let entries = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (entries.length === 0) {
    const code = dataTransfer.getData("application/vnd.code.uri-list");
    if (code.length > 0) {
      try {
        const parsed: unknown = JSON.parse(code);
        entries = Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === "string")
          : [];
      } catch {
        entries = code
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }
    }
  }
  return entries
    .filter(
      (uri) =>
        uri.startsWith("file://") && uri.length <= MAX_ATTACHMENT_URI_LENGTH,
    )
    .slice(0, MAX_ATTACHMENT_URI_COUNT);
}

export function readDroppedRemoteImageUrl(
  dataTransfer: Pick<DataTransfer, "getData">,
): string | null {
  const candidates = [
    ...dataTransfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .map((value) => value.trim()),
    dataTransfer.getData("text/plain").trim(),
  ];
  const html = dataTransfer.getData("text/html");
  const htmlSrc = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (htmlSrc !== undefined) {
    candidates.push(htmlSrc);
  }
  for (const candidate of candidates) {
    if (
      candidate.length === 0 ||
      candidate.length > MAX_ATTACHMENT_REMOTE_URL_LENGTH
    ) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        url.username.length === 0 &&
        url.password.length === 0
      ) {
        return url.href;
      }
    } catch {
      // Keep looking through the bounded drag formats.
    }
  }
  return null;
}

export function readFileAsBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve(null);
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator === -1 ? null : result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
