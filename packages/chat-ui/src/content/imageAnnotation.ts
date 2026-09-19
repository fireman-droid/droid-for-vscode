export interface Point { readonly x: number; readonly y: number }
export interface Stroke { readonly points: readonly Point[]; readonly width: number }

export function isAnimatedWebp(dataBase64: string): boolean {
  try {
    return atob(dataBase64.slice(0, 256)).includes('ANIM');
  } catch {
    return true;
  }
}

export function drawStroke(context: CanvasRenderingContext2D, points: readonly Point[], width: number): void {
  if (points.length === 0) return;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

export function canvasToBlob(canvas: HTMLCanvasElement, mediaType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('Image encoding failed.'));
      else resolve(blob);
    }, mediaType, quality);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Image encoding failed.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
