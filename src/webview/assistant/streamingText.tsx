import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ExtraProps } from 'react-markdown';
import { useReducedMotion } from './processPresentation';

type ElementNode = NonNullable<ExtraProps['node']>;
interface TextTree {
  type: string;
  tagName?: string | undefined;
  value?: string | undefined;
  children?: TextTree[] | undefined;
  properties?: Record<string, unknown> | undefined;
  position?: ElementNode['position'];
}

const SKIP = new Set(['pre', 'code', 'table', 'svg', 'math', 'span']);

export function rehypeStreamingText() {
  return (tree: TextTree): void => {
    const visit = (node: TextTree, prose: boolean): void => {
      if (SKIP.has(node.tagName ?? '') || node.children === undefined) return;
      const eligible = prose || node.tagName === 'p' || node.tagName === 'li';
      node.children = node.children.map((child) => {
        if (eligible && child.type === 'text' && child.value?.trim()) {
          return {
            type: 'element',
            tagName: 'span',
            properties: {
              'data-stream-start': child.position?.start.offset ?? -1,
              'data-stream-end': child.position?.end.offset ?? -1,
            },
            children: [child],
          };
        }
        visit(child, eligible);
        return child;
      });
    };
    visit(tree, false);
  };
}

interface StreamState {
  readonly running: boolean;
  readonly committedLength: RefObject<number>;
}
const StreamContext = createContext<StreamState>({
  running: false,
  committedLength: { current: 0 },
});

export function StreamingTextBoundary({ initialLength, running, children }: {
  readonly initialLength: number;
  readonly running: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const committedLength = useRef(initialLength);
  // The watermark follows committed Markdown leaves, not incoming tokens:
  // deferred parsing can be a render behind the authoritative message.
  const value = useMemo(() => ({
    running: running && !reduced,
    committedLength,
  }), [running, reduced]);
  return (
    <StreamContext.Provider value={value}>
      {children}
    </StreamContext.Provider>
  );
}

export function StreamingSpan({ node, children, ...props }:
  HTMLAttributes<HTMLSpanElement> & ExtraProps,
): React.JSX.Element {
  const start = node?.properties['data-stream-start'];
  if (typeof start !== 'number' || typeof children !== 'string') {
    return <span {...props}>{children}</span>;
  }
  const end = node?.properties['data-stream-end'];
  return (
    <FadingText text={children} start={start}
      end={typeof end === 'number' ? end : start} />
  );
}

export const FadingText = memo(function FadingText({ text, start, end }: {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}): React.JSX.Element {
  const { running, committedLength } = useContext(StreamContext);
  useLayoutEffect(() => {
    committedLength.current = Math.max(committedLength.current, end);
  }, [end, committedLength]);
  const selected = typeof window !== 'undefined' &&
    window.getSelection()?.isCollapsed === false;
  const [rendered, setRendered] = useState(() => ({
    text,
    prefix: running && !selected && start >= committedLength.current ? 0 : text.length,
  }));
  if (rendered.text !== text) {
    setRendered({
      text,
      prefix: text.startsWith(rendered.text)
        ? selected ? rendered.prefix : running ? rendered.text.length : text.length
        : text.length,
    });
  } else if (!running && !selected && rendered.prefix !== text.length) {
    setRendered({ text, prefix: text.length });
  }
  let prefix = running || selected ? rendered.prefix : text.length;
  if (prefix >= text.length || rendered.text !== text) return <>{text}</>;
  // Stream boundaries can split a UTF-16 surrogate pair.
  if (prefix > 0 && (text.charCodeAt(prefix - 1) & 0xfc00) === 0xd800) prefix -= 1;
  return (
    <>
      {text.slice(0, prefix)}
      <span key={prefix} className={selected ? undefined : 'dvx-stream-in'} onAnimationEnd={() => {
        if (window.getSelection()?.isCollapsed === false) return;
        setRendered((current) => current.text === text
          ? { text, prefix: text.length } : current);
      }}>{text.slice(prefix)}</span>
    </>
  );
});
