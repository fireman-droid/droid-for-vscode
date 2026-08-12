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
import type { ToolActivityPresentation } from "./readers";

/**
 * The command card's `$`-prefixed command line. Tokens carry warm
 * syntax tints (command / flag / string / path); joining them
 * reproduces the command byte for byte, so nothing is invented.
 */
export function CommandWellLine({
  command,
}: {
  readonly command: string;
}): React.JSX.Element {
  const tokens = useMemo(() => tokenizeCommand(command), [command]);
  return (
    <div className="dvx-command-line">
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
    </div>
  );
}

/**
 * "…" overflow menu on the command card header. Copy Command only:
 * Cursor's Auto-Run/Allowlist entries belong to its permission
 * system, which we do not imitate. Exported for focused tests.
 */
export function CommandCardMenu({
  command,
}: {
  readonly command: string;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void navigator.clipboard?.writeText(command);
              setCopied(true);
              if (closeTimerRef.current !== null) {
                clearTimeout(closeTimerRef.current);
              }
              // A beat of "Copied" feedback, then the menu retires.
              closeTimerRef.current = setTimeout(() => {
                setMenuOpen(false);
                setCopied(false);
              }, 900);
            }}
          >
            {copied ? "Copied" : "Copy Command"}
          </button>
        </div>
      ) : null}
    </span>
  );
}

/**
 * Quiet expanded-area action on a live execute row: reveal the
 * read-only terminal mirror (native-terminal design slice A). Only
 * running rows qualify — history and replay rows are never
 * "running", so playback stays entryless by construction. Exported
 * for focused visibility and wiring tests.
 */
export function ExecuteMirrorEntry({
  status,
  detailKind,
}: {
  readonly status: ToolActivityPresentation["status"];
  readonly detailKind: ToolActivityPresentation["detailKind"];
}): React.JSX.Element | null {
  const openMirror = useContext(TerminalMirrorContext);
  if (
    openMirror === null ||
    status !== "running" ||
    detailKind !== "command"
  ) {
    return null;
  }
  return (
    <button
      type="button"
      className="dvx-terminal-mirror-entry"
      title="在只读镜像终端中实时查看命令输出"
      onClick={openMirror}
    >
      在终端中查看
    </button>
  );
}
