import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  type ImageMediaType,
} from "../../shared/bridgeMessages";
import {
  dismissOverlay,
  ImageActualSizeIcon,
  ImageCloseIcon,
  ImageFitIcon,
  ImageZoomInIcon,
  ImageZoomOutIcon,
  nextImageZoom,
} from "./Lightbox";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const FIT_PADDING = 24;
const PEN_COLOR = "#E5484D";
const PEN_SCREEN_WIDTH = 4;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Stroke {
  readonly points: readonly Point[];
  readonly width: number;
}

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
  fit: number;
}

export function StagedImageLightbox({
  src,
  mediaType,
  annotatable,
  onSave,
  onClose,
}: {
  readonly src: string;
  readonly mediaType: ImageMediaType;
  readonly annotatable: boolean;
  readonly onSave: (
    dataBase64: string,
    mediaType: ImageMediaType,
    sizeBytes: number,
  ) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0, fit: 1 });
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const activeStrokeRef = useRef<Point[] | null>(null);
  const frameRef = useRef<number | null>(null);
  const spaceDownRef = useRef(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [strokes, setStrokes] = useState<readonly Stroke[]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const applyView = useCallback((animate = false): void => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    const view = viewRef.current;
    stage.classList.toggle("dvx-image-animate", animate);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    });
    setZoomPercent(Math.round(view.scale * 100));
  }, []);

  const redraw = useCallback(
    (nextStrokes = strokes, active = activeStrokeRef.current): void => {
      const canvas = canvasRef.current;
      if (canvas === null || size === null) {
        return;
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        return;
      }
      context.clearRect(0, 0, size.width, size.height);
      context.strokeStyle = PEN_COLOR;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stroke of nextStrokes) {
        drawStroke(context, stroke.points, stroke.width);
      }
      if (active !== null) {
        drawStroke(
          context,
          active,
          PEN_SCREEN_WIDTH / viewRef.current.scale,
        );
      }
    },
    [size, strokes],
  );

  useEffect(() => redraw(), [redraw]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (container === null || stage === null || size === null) {
      return;
    }
    stage.style.width = `${size.width}px`;
    stage.style.height = `${size.height}px`;
    stage.style.marginLeft = `${-size.width / 2}px`;
    stage.style.marginTop = `${-size.height / 2}px`;
    const fit = Math.min(
      1,
      (container.clientWidth - FIT_PADDING * 2) / size.width,
      (container.clientHeight - FIT_PADDING * 2) / size.height,
    );
    viewRef.current = { scale: fit, tx: 0, ty: 0, fit };
    applyView();
  }, [applyView, size]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        spaceDownRef.current = true;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      if (annotating) {
        setStrokes([]);
        setAnnotating(false);
        setSaveError(null);
        activeStrokeRef.current = null;
        redraw([], null);
      } else {
        onClose();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        spaceDownRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [annotating, onClose, redraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const view = viewRef.current;
      const next = clampZoom(
        view.scale *
          Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)),
      );
      if (next === view.scale) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const ratio = next / view.scale;
      view.tx = px - ratio * (px - view.tx);
      view.ty = py - ratio * (py - view.ty);
      view.scale = next;
      applyView();
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [applyView]);

  const resetToFit = (): void => {
    const view = viewRef.current;
    view.scale = view.fit;
    view.tx = 0;
    view.ty = 0;
    applyView(true);
  };
  const zoomToActual = (): void => {
    const view = viewRef.current;
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    applyView(true);
  };
  const stepZoom = (direction: -1 | 1): void => {
    const view = viewRef.current;
    const next = nextImageZoom(view.scale, direction);
    if (next === undefined) {
      return;
    }
    view.scale = next;
    applyView(true);
  };

  const pointerPoint = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): Point | null => {
    const canvas = canvasRef.current;
    if (canvas === null || size === null) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (size.width / rect.width),
      y: (event.clientY - rect.top) * (size.height / rect.height),
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (spaceDownRef.current || !annotatable) {
      panRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    const point = pointerPoint(event);
    if (point === null) {
      return;
    }
    setAnnotating(true);
    setSaveError(null);
    activeStrokeRef.current = [point];
    redraw(strokes, activeStrokeRef.current);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan !== null) {
      const view = viewRef.current;
      view.tx += event.clientX - pan.x;
      view.ty += event.clientY - pan.y;
      panRef.current = { x: event.clientX, y: event.clientY };
      applyView();
      return;
    }
    const active = activeStrokeRef.current;
    const point = pointerPoint(event);
    if (active === null || point === null) {
      return;
    }
    active.push(point);
    redraw(strokes, active);
  };

  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
    const points = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (points === null) {
      return;
    }
    const next = [
      ...strokes,
      {
        points: points.length === 1 ? [points[0]!, points[0]!] : points,
        width: PEN_SCREEN_WIDTH / viewRef.current.scale,
      },
    ];
    setStrokes(next);
    redraw(next, null);
  };

  const save = async (): Promise<void> => {
    const image = imageRef.current;
    if (image === null || size === null || strokes.length === 0) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new Error("Canvas is unavailable.");
      }
      context.drawImage(image, 0, 0, size.width, size.height);
      context.strokeStyle = PEN_COLOR;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stroke of strokes) {
        drawStroke(context, stroke.points, stroke.width);
      }
      const blob = await canvasToBlob(
        canvas,
        mediaType,
        mediaType === "image/png" ? undefined : 0.92,
      );
      if (blob.size > MAX_ATTACHMENT_IMAGE_BYTES) {
        setSaveError("Annotated image exceeds the 4 MB attachment limit.");
        return;
      }
      const dataBase64 = await blobToBase64(blob);
      onSave(dataBase64, mediaType, blob.size);
      onClose();
    } catch {
      setSaveError("The annotation could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const closeFromBackdrop = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.target !== event.currentTarget || annotating) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dismissOverlay(onClose);
  };

  return createPortal(
    <div
      ref={containerRef}
      className="dvx-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Pending image preview"
      onPointerDown={closeFromBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget && !annotating) {
          event.stopPropagation();
        }
      }}
    >
      <div
        ref={stageRef}
        className={`dvx-image-full dvx-staged-image-stage${
          annotatable ? " dvx-staged-image-drawable" : ""
        }${spaceDownRef.current ? " dvx-image-grab" : ""}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onClick={(event) => event.stopPropagation()}
      >
        <img
          ref={imageRef}
          className="dvx-lightbox-image"
          src={src}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            setSize({
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          }}
        />
        {size !== null ? (
          <canvas
            ref={canvasRef}
            className="dvx-staged-image-canvas"
            width={size.width}
            height={size.height}
            aria-hidden="true"
          />
        ) : null}
      </div>
      {zoomPercent !== null ? (
        <span className="dvx-image-zoom-indicator">{zoomPercent}%</span>
      ) : null}
      {saveError !== null ? (
        <div className="dvx-staged-image-error" role="status">
          {saveError}
        </div>
      ) : null}
      <div
        className="dvx-image-lightbox-actions"
        role="toolbar"
        aria-label={
          annotating ? "Image annotation controls" : "Image preview controls"
        }
      >
        {annotating ? (
          <>
            <button
              type="button"
              className="dvx-image-lightbox-action"
              disabled={strokes.length === 0}
              onClick={() => {
                const next = strokes.slice(0, -1);
                setStrokes(next);
                redraw(next, null);
              }}
            >
              Undo
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-action"
              onClick={() => {
                setStrokes([]);
                setAnnotating(false);
                setSaveError(null);
                redraw([], null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-action"
              disabled={saving || strokes.length === 0}
              onClick={() => void save()}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="dvx-image-lightbox-icon"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={
                zoomPercent !== null && zoomPercent <= MIN_ZOOM * 100
              }
              onClick={() => stepZoom(-1)}
            >
              <ImageZoomOutIcon />
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-icon"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={
                zoomPercent !== null && zoomPercent >= MAX_ZOOM * 100
              }
              onClick={() => stepZoom(1)}
            >
              <ImageZoomInIcon />
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-icon"
              aria-label="Fit image to preview"
              title="Fit image to preview"
              onClick={resetToFit}
            >
              <ImageFitIcon />
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-icon"
              aria-label="Show image at actual size"
              title="Actual size"
              onClick={zoomToActual}
            >
              <ImageActualSizeIcon />
            </button>
            <button
              type="button"
              className="dvx-image-lightbox-close"
              aria-label="Close pending image preview"
              title="Close"
              onClick={onClose}
            >
              <ImageCloseIcon />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function isAnimatedWebp(dataBase64: string): boolean {
  try {
    const prefix = atob(dataBase64.slice(0, 256));
    return prefix.includes("ANIM");
  } catch {
    return true;
  }
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
): void {
  if (points.length === 0) {
    return;
  }
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mediaType: ImageMediaType,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error("Image encoding failed."));
        } else {
          resolve(blob);
        }
      },
      mediaType,
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Image encoding failed."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
