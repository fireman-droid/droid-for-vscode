import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../chat/processPresentation';

const CATCH_UP_MS = 180;
const FRAME_MS = 1000 / 30;
const MIN_CHARS_PER_SECOND = 60;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Pace only the live Review answer; saved answers remain immediately readable. */
export function useSmoothedAnswer(text: string, streaming: boolean): string {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(streaming ? '' : text);
  const playback = useRef({
    text: visible, visible, position: visible.length, rate: MIN_CHARS_PER_SECOND,
    lastFrame: 0, lastPaint: 0, frame: null as number | null,
    streaming, segments: graphemes.segment(visible),
  });

  useLayoutEffect(() => {
    const current = playback.current;
    const appended = text.startsWith(current.text);
    const changed = text !== current.text;
    current.text = text;
    current.streaming = streaming;
    if (changed) current.segments = graphemes.segment(text);

    if (reducedMotion || document.hidden || !appended || (!streaming && current.position >= text.length)) {
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.frame = null;
      current.position = text.length;
      current.visible = text;
      setVisible(text);
      return;
    }
    if (changed) current.rate = Math.max(MIN_CHARS_PER_SECOND, (text.length - current.position) * 1000 / CATCH_UP_MS);
    if (current.frame !== null || current.position >= text.length) return;
    current.lastFrame = current.lastPaint = performance.now();

    const tick = (now: number) => {
      current.frame = null;
      current.position = Math.min(current.text.length, current.position + (now - current.lastFrame) * current.rate / 1000);
      current.lastFrame = now;
      const caughtUp = current.position >= current.text.length;
      // Pace Markdown at roughly 30 Hz; publish the final tail without another wait.
      if (caughtUp || now - current.lastPaint >= FRAME_MS) {
        let end = current.segments.containing(Math.floor(current.position))?.index ?? current.text.length;
        // A transport update can end halfway through a UTF-16 surrogate pair.
        if (current.streaming && end > 0 && (current.text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end -= 1;
        const next = current.text.slice(0, end);
        if (next !== current.visible) { current.visible = next; setVisible(next); }
        current.lastPaint = now;
      }
      if (!caughtUp) current.frame = requestAnimationFrame(tick);
    };
    current.frame = requestAnimationFrame(tick);
  }, [text, streaming, reducedMotion]);

  useEffect(() => {
    const flushHidden = () => {
      if (!document.hidden) return;
      const current = playback.current;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.frame = null;
      current.position = current.text.length;
      current.visible = current.text;
      setVisible(current.text);
    };
    document.addEventListener('visibilitychange', flushHidden);
    return () => {
      document.removeEventListener('visibilitychange', flushHidden);
      if (playback.current.frame !== null) cancelAnimationFrame(playback.current.frame);
      playback.current.frame = null;
    };
  }, []);

  return visible;
}
