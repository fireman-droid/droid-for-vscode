// commandCard: moved verbatim from Thread.tsx (structure-only refactor).

import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { tokenizeCommand } from "../commandCard";
import { TerminalMirrorContext } from "../Thread";
import { CheckIcon, CopyIcon } from "./icons";
import type { ToolActivityPresentation } from "./readers";

/** Cursor-style terminal marker: prompt at rest, disclosure on hover/open. */
export function CommandCardLeading(): React.JSX.Element {
  return (
    <span className="dvx-command-leading" aria-hidden="true">
      <span className="dvx-command-leading-prompt">&gt;_</span>
      <svg
        className="dvx-command-leading-chevron"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M4.5 2.5 8 6 4.5 9.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** One scroll surface containing both the tinted command and gray output. */
export function CommandTerminalContent({
  command,
  outputText,
  running,
  open,
}: {
  readonly command: string;
  readonly outputText: string | null;
  readonly running: boolean;
  readonly open: boolean;
}): React.JSX.Element {
  const tokens = useMemo(() => tokenizeCommand(command), [command]);
  const preRef = useRef<HTMLPreElement | null>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const pre = preRef.current;
    if (running && open && pinnedRef.current && pre !== null) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [open, outputText, running]);
  return (
    <pre
      ref={preRef}
      className="dvx-command-well"
      onScroll={(event) => {
        const pre = event.currentTarget;
        pinnedRef.current =
          pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
      }}
    >
      <span className="dvx-command-entry">
        <span className="dvx-command-prompt" aria-hidden="true">
          $
        </span>
        <code className="dvx-command-code">
          {tokens.map((token, index) =>
            token.kind === "text" ? (
              token.text
            ) : (
              <span key={index} className={`dvx-cmd-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </span>
      {outputText === null ? null : (
        <span className="dvx-command-output">{outputText}</span>
      )}
    </pre>
  );
}

/**
 * "…" overflow menu on the command card header. Copy Command only:
 * Cursor's Auto-Run/Allowlist entries belong to its permission
 * system, which we do not imitate. Exported for focused tests.
 */
export function CommandCardMenu({
  command,
  terminalMirrorAvailable,
}: {
  readonly command: string;
  readonly terminalMirrorAvailable: boolean;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const openMirror = useContext(TerminalMirrorContext);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (
        rootRef.current !== null &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
        setCopied(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setCopied(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );
  return (
    <span className="dvx-command-menu-root" ref={rootRef}>
      <button
        type="button"
        className="dvx-command-menu-trigger"
        aria-label="Command actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen((value) => !value);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>
      {menuOpen ? (
        <div className="dvx-command-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            aria-label={copied ? "Command copied" : "Copy Command"}
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              try {
                await navigator.clipboard.writeText(command);
              } catch {
                setCopied(false);
                return;
              }
              if (rootRef.current === null) {
                return;
              }
              setCopied(true);
              if (closeTimerRef.current !== null) {
                clearTimeout(closeTimerRef.current);
              }
              closeTimerRef.current = setTimeout(() => {
                setMenuOpen(false);
                setCopied(false);
              }, 900);
            }}
          >
            <span className="dvx-command-copy-icon" aria-hidden="true">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </span>
            Copy Command
          </button>
          {terminalMirrorAvailable && openMirror !== null ? (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenuOpen(false);
                openMirror();
              }}
            >
              在终端中查看
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
