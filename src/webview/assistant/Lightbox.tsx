import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import {
  adoptDiagramStyles,
  reapplyInlineStyles,
} from './mermaidRenderer';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** Breathing room around the fitted content, in px per side. */
const FIT_PADDING = 24;

export interface MediaSize {
  readonly width: number;
  readonly height: number;
}

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
  /** Scale that fits the content inside the viewport (never upscales). */
  fit: number;
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Close a body-portaled overlay without letting the same pointer
 * fall through to the transcript (which would flash the edit card
 * or native textarea).
 */
export function dismissOverlay(onClose: () => void): void {
  const swallow = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('pointerup', swallow, true);
  document.addEventListener('click', swallow, true);
  window.setTimeout(() => {
    document.removeEventListener('pointerup', swallow, true);
    document.removeEventListener('click', swallow, true);
  }, 0);
  onClose();
}

/**
 * Full-viewport media viewer shared by transcript images and mermaid
 * diagrams: wheel (and touchpad pinch via ctrl+wheel) zooms anchored
 * at the cursor, dragging pans once magnified past fit, double-click
 * toggles fit and 100% (2x for content smaller than the viewport),
 * and explicit Reset / 1:1 controls sit next to the close button.
 * Transform math lives outside React state; frames are written
 * through requestAnimationFrame.
 *
 * `contentSize` is the natural (unscaled) content resolution; the
 * viewer idles until the caller reports it (image load, SVG mount).
 */
export function MediaLightbox({
  label,
  contentSize,
  onClose,
  children,
}: {
  readonly label: string;
  readonly contentSize: MediaSize | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0, fit: 1 });
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const [pannable, setPannable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const closedRef = useRef(false);

  const closeFromBackdrop = (event: ReactMouseEvent): void => {
    if (event.target !== event.currentTarget || closedRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closedRef.current = true;
    dismissOverlay(onClose);
  };

  const applyView = useCallback((animate = false): void => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    const view = viewRef.current;
    // The reduced-motion media query zeroes this transition in CSS.
    stage.classList.toggle('dvx-image-animate', animate);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    });
    setZoomPercent(Math.round(view.scale * 100));
    setPannable(view.scale > view.fit + 0.001);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Sizes the stage at the content's natural resolution centered in
  // the viewport, so `scale` reads directly as a zoom percentage.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (
      container === null ||
      stage === null ||
      contentSize === null ||
      contentSize.width === 0 ||
      contentSize.height === 0
    ) {
      return;
    }
    const { width, height } = contentSize;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.style.marginLeft = `${-width / 2}px`;
    stage.style.marginTop = `${-height / 2}px`;
    const fit = Math.min(
      1,
      (container.clientWidth - FIT_PADDING * 2) / width,
      (container.clientHeight - FIT_PADDING * 2) / height,
    );
    viewRef.current = { scale: fit, tx: 0, ty: 0, fit };
    applyView();
  }, [contentSize, applyView]);

  // React registers wheel listeners passively, so the zoom handler
  // attaches natively to be able to preventDefault page scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const view = viewRef.current;
      // Touchpad pinch arrives as ctrl+wheel with small deltas; give
      // it a stronger response so the gesture feels 1:1.
      const factor = Math.exp(
        -event.deltaY * (event.ctrlKey ? 0.01 : 0.002),
      );
      const next = clampZoom(view.scale * factor);
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
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyView]);

  const resetToFit = useCallback((): void => {
    const view = viewRef.current;
    view.scale = view.fit;
    view.tx = 0;
    view.ty = 0;
    applyView(true);
  }, [applyView]);

  const zoomToActualSize = useCallback((): void => {
    const view = viewRef.current;
    view.scale = clampZoom(1);
    view.tx = 0;
    view.ty = 0;
    applyView(true);
  }, [applyView]);

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent): void => {
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const view = viewRef.current;
      const atFit = Math.abs(view.scale - view.fit) < 0.01;
      if (atFit) {
        // 100% for content larger than the viewport, 2x for smaller.
        const target = clampZoom(view.fit < 1 ? 1 : view.fit * 2);
        const rect = container.getBoundingClientRect();
        const px = event.clientX - rect.left - rect.width / 2;
        const py = event.clientY - rect.top - rect.height / 2;
        const ratio = target / view.scale;
        view.tx = px - ratio * (px - view.tx);
        view.ty = py - ratio * (py - view.ty);
        view.scale = target;
        applyView(true);
      } else {
        resetToFit();
      }
    },
    [applyView, resetToFit],
  );

  // A portal keeps the fixed-position overlay out of the transcript
  // tree: an ancestor with a CSS transform would otherwise become the
  // containing block and could clip the controls off-screen.
  return createPortal(
    <div
      ref={containerRef}
      className="dvx-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={closeFromBackdrop}
      onClick={closeFromBackdrop}
    >
      <div
        ref={stageRef}
        className={`dvx-image-full dvx-lightbox-stage${
          pannable
            ? dragging
              ? ' dvx-image-grabbing'
              : ' dvx-image-grab'
            : ''
        }`}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onPointerDown={(event) => {
          if (!pannable || event.button !== 0) {
            return;
          }
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const last = dragRef.current;
          if (last === null) {
            return;
          }
          const view = viewRef.current;
          view.tx += event.clientX - last.x;
          view.ty += event.clientY - last.y;
          dragRef.current = { x: event.clientX, y: event.clientY };
          applyView();
        }}
        onPointerUp={(event) => {
          if (dragRef.current === null) {
            return;
          }
          event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        {children}
      </div>
      {zoomPercent !== null ? (
        <span className="dvx-image-zoom-indicator" aria-live="polite">
          {zoomPercent}%
        </span>
      ) : null}
      <div className="dvx-image-lightbox-actions">
        <button
          type="button"
          className="dvx-image-lightbox-action"
          aria-label="Reset zoom to fit"
          onClick={(event) => {
            event.stopPropagation();
            resetToFit();
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="dvx-image-lightbox-action"
          aria-label="Zoom to 100%"
          onClick={(event) => {
            event.stopPropagation();
            zoomToActualSize();
          }}
        >
          1:1
        </button>
        <button
          type="button"
          className="dvx-image-lightbox-close"
          aria-label={`Close ${label.toLocaleLowerCase()}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Reads the natural diagram resolution from the SVG viewBox. */
export function readSvgNaturalSize(svg: SVGSVGElement): MediaSize | null {
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox !== null) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const width = parts[2];
    const height = parts[3];
    if (
      width !== undefined &&
      height !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }
  }
  return null;
}

/**
 * Fullscreen viewer for one rendered mermaid diagram: the SVG mounts
 * at its natural viewBox resolution inside the shared lightbox, so
 * zooming stays vector-crisp at any scale. Diagram CSS re-adopts for
 * the viewer's lifetime (each adoption holds its own sheet).
 */
export function DiagramLightbox({
  svg,
  css,
  onClose,
}: {
  readonly svg: string;
  readonly css: string;
  readonly onClose: () => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<MediaSize | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    host.innerHTML = svg;
    reapplyInlineStyles(host);
    const release = adoptDiagramStyles(css);
    const element = host.querySelector('svg');
    if (element !== null) {
      // Mermaid emits width:100% capped by an inline max-width; the
      // stage is sized to the natural resolution instead, so the SVG
      // just fills it.
      element.style.maxWidth = 'none';
      element.style.width = '100%';
      element.style.height = '100%';
      element.removeAttribute('width');
      element.removeAttribute('height');
      setSize(readSvgNaturalSize(element) ?? { width: 800, height: 600 });
    }
    return () => {
      release();
      host.replaceChildren();
    };
  }, [svg, css]);
  return (
    <MediaLightbox
      label="Diagram preview"
      contentSize={size}
      onClose={onClose}
    >
      <div
        ref={hostRef}
        className="dvx-lightbox-diagram"
        role="img"
        aria-label="Mermaid diagram"
      />
    </MediaLightbox>
  );
}
