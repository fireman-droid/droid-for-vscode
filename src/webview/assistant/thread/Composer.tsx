// Composer: moved verbatim from Thread.tsx (structure-only refactor).

import { ComposerPrimitive, useAui } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_ATTACHMENT_URI_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
  type AttachmentSummary,
  type ImageMediaType,
  type ModelCatalogState,
  type SessionContextState,
  type SessionSettingsState,
} from "../../../shared/bridgeMessages";
import { MAX_QUEUED_MESSAGES } from "../../../shared/queueProtocol";
import type { SessionTokenUsageState } from "../../../shared/tokenUsage";
import {
  ComposerControls,
  type ComposerNavRequest,
  type McpAuthProgress,
  type McpPanelState,
  type McpServerAddParams,
  type PluginsPanelState,
  type SessionSettingSelection,
  type SkillsPanelState,
} from "../ComposerControls";
import { ComposerPopup } from "../ComposerPopup";
import { rememberImagePreview } from "../imagePreviewCache";
import { AttachmentChip } from "./AttachmentChip";
import {
  CANVAS_REQUEST_TEMPLATE,
  SLASH_NAV_COMMANDS,
  type SlashNavTarget,
} from "../slashBuiltins";
import type { FileSearchResult, SlashCommandsState } from "../Thread";
import {
  BTW_COMMAND,
  BUILT_IN_COMMANDS,
  MAX_SLASH_SKILL_MATCHES,
  filterSlashCommands,
  findMentionToken,
  findSlashToken,
  splitMentionPath,
  type MentionToken,
  type SlashEntry,
  type SlashToken,
} from "./composerCommands";
import { ComposerSendButton } from "./ComposerSendButton";

export function Composer({
  statusMessage,
  showRetry,
  running,
  stopping,
  interactionPending,
  controlsDisabled,
  settingUpdatesDisabled,
  settings,
  context,
  tokenUsage,
  modelCatalog,
  skills,
  mcp,
  plugins,
  onRetry,
  onContextRefresh,
  compactPending,
  onCompact,
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onMcpServerAdd,
  onMcpServerRemove,
  mcpAuth,
  onMcpServerAuthenticate,
  onPluginsRefresh,
  onNewSession,
  attachments,
  fileSearch,
  onFileSearch,
  commands,
  onCommandsRefresh,
  navSignal = null,
  onSlashNavigate,
  missionActive = false,
  onMissionOpen,
  btwAvailable = false,
  onBtwOpen,
  onAttachPath,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
  onAttachImage,
  onAttachUris,
  onAttachTextFile,
  onAttachmentRemove,
  onDraftChange,
  queuedCount = 0,
  queueEditing = false,
  onQueueEditCancel,
}: {
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly interactionPending: boolean;
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly tokenUsage: SessionTokenUsageState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
  readonly onRetry: () => void;
  readonly onContextRefresh: () => void;
  readonly compactPending: boolean;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onPluginsRefresh: () => void;
  /** Starts a fresh session (skill changes apply at session start). */
  readonly onNewSession: () => void;
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly commands: SlashCommandsState;
  readonly onCommandsRefresh: () => void;
  readonly navSignal?: ComposerNavRequest | null;
  readonly onSlashNavigate?: (target: SlashNavTarget) => void;
  readonly missionActive?: boolean;
  readonly onMissionOpen?: () => void;
  /** Renders the `/btw` popup row when the host supports side chat. */
  readonly btwAvailable?: boolean;
  /** Opens the side-chat panel from the `/btw` popup row. */
  readonly onBtwOpen?: () => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachImage: (
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onAttachUris: (uris: readonly string[]) => void;
  readonly onAttachTextFile: (
    name: string,
    text: string,
    truncated: boolean,
  ) => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
  /** Prompts queued behind the running turn (hint copy). */
  readonly queuedCount?: number;
  /** A queued prompt is loaded into the Composer ("Edit Queued"). */
  readonly queueEditing?: boolean;
  /** Leaves "Edit Queued" mode, clearing the Composer draft. */
  readonly onQueueEditCancel?: () => void;
}): React.JSX.Element {
  const aui = useAui();
  const draftRef = useRef("");
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const searchCounterRef = useRef(0);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  // Transient user-visible feedback for drops that stage nothing
  // (binary files, oversized images, staging area full).
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const dropNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (dropNoticeTimer.current !== null) {
        clearTimeout(dropNoticeTimer.current);
      }
    },
    [],
  );
  const showDropNotice = (message: string): void => {
    setDropNotice(message);
    if (dropNoticeTimer.current !== null) {
      clearTimeout(dropNoticeTimer.current);
    }
    dropNoticeTimer.current = setTimeout(() => setDropNotice(null), 5000);
  };

  /**
   * Stages one image file through the host attachment pipeline and
   * remembers its data URL locally so the pending chip can render a
   * thumbnail without the bytes crossing the bridge again.
   */
  const stageImageFile = (file: File): void => {
    if (file.size === 0 || file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
      showDropNotice(
        `${file.name || "Image"} is too large to attach (4 MB max).`,
      );
      return;
    }
    const mediaType = file.type as ImageMediaType;
    const name = file.name.trim().length > 0 ? file.name : "pasted-image";
    void readFileAsBase64(file).then((dataBase64) => {
      if (dataBase64 !== null) {
        rememberImagePreview(
          name,
          file.size,
          `data:${mediaType};base64,${dataBase64}`,
        );
        onAttachImage(name, mediaType, dataBase64);
      }
    });
  };

  /**
   * Stages one non-image dropped file as a text attachment. The bytes
   * never leave the webview unless they decode as NUL-free text within
   * the shared character cap; binary or unreadable files produce a
   * visible notice instead.
   */
  const stageDroppedTextFile = async (file: File): Promise<void> => {
    if (file.size === 0) {
      showDropNotice(`${file.name} is empty and was not attached.`);
      return;
    }
    // UTF-16 length ≤ UTF-8 byte length, so 4× the character cap is
    // always enough bytes to fill the cap; larger files are cut here
    // to avoid decoding unbounded content in the webview.
    const byteCap = MAX_ATTACHMENT_TEXT_FILE_CHARS * 4;
    const blob = file.size > byteCap ? file.slice(0, byteCap) : file;
    let raw: string;
    try {
      raw = await blob.text();
    } catch {
      showDropNotice(`${file.name} could not be read.`);
      return;
    }
    if (raw.includes("\u0000")) {
      showDropNotice(
        `${file.name} is not a text file. Use “+” → Attach files instead.`,
      );
      return;
    }
    const truncated =
      file.size > byteCap || raw.length > MAX_ATTACHMENT_TEXT_FILE_CHARS;
    const text = truncated ? raw.slice(0, MAX_ATTACHMENT_TEXT_FILE_CHARS) : raw;
    onAttachTextFile(file.name, text, truncated);
  };

  /**
   * Stages dropped or pasted files: images through the base64 image
   * path, everything else as decoded text files. The list is truncated
   * to the remaining staging slots so the host limit diagnostic never
   * fires from a single multi-file drop.
   */
  const stageDroppedFiles = (files: readonly File[]): void => {
    const remaining = MAX_PENDING_ATTACHMENTS - attachments.length;
    if (files.length > remaining) {
      showDropNotice(
        `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
      );
    }
    for (const file of files.slice(0, Math.max(remaining, 0))) {
      if (isImageMediaType(file.type)) {
        stageImageFile(file);
      } else {
        void stageDroppedTextFile(file);
      }
    }
  };

  /**
   * Routes one composer drop. Editor explorer drags carry `file://`
   * URIs that the host resolves against the workspace; system file
   * manager drags carry the file bytes directly.
   */
  const handleComposerDrop = (dataTransfer: DataTransfer): boolean => {
    const uris = readDroppedFileUris(dataTransfer);
    if (uris.length > 0) {
      const remaining = MAX_PENDING_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showDropNotice(
          `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
        );
        return true;
      }
      if (uris.length > remaining) {
        showDropNotice(
          `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
        );
      }
      onAttachUris(
        uris.slice(0, Math.min(remaining, MAX_ATTACHMENT_URI_COUNT)),
      );
      return true;
    }
    const files = Array.from(dataTransfer.files);
    if (files.length > 0) {
      stageDroppedFiles(files);
      return true;
    }
    return false;
  };

  // Load the command catalog lazily when the `/` popup first opens;
  // reopening after an error retries the fetch. `controlsDisabled`
  // mirrors the host guard that swallows the refresh while the bridge
  // is not connected, so a popup opened early re-requests the catalog
  // once the connection comes up. Enabled skills fill the popup's
  // Skills section, so they load on the same trigger.
  const slashOpen = slash !== null;
  const commandsStatus = commands.status;
  const skillsStatus = skills.status;
  useEffect(() => {
    if (slashOpen && !controlsDisabled) {
      if (commandsStatus === "idle" || commandsStatus === "error") {
        onCommandsRefresh();
      }
      if (skillsStatus === "idle") {
        onSkillsRefresh();
      }
    }
    // Refetch only on open/close and connection transitions.
  }, [slashOpen, controlsDisabled]);

  const commandMatches =
    slash !== null
      ? filterSlashCommands(commands, slash.query).filter(
          (command) => command.name !== "mission",
        )
      : [];
  // Capability-gated built-ins fail closed when their Host support is absent.
  const builtInCommands = [
    ...BUILT_IN_COMMANDS,
    ...(btwAvailable ? [BTW_COMMAND] : []),
  ];
  const builtInMatches =
    slash !== null
      ? builtInCommands.filter((command) =>
          command.name.startsWith(slash.query.toLocaleLowerCase()),
        )
      : [];
  // Navigation rows open existing panels instead of completing text;
  // they render inside the same Built-in group (slash-parity S2).
  const navMatches =
    slash !== null && onSlashNavigate !== undefined
      ? SLASH_NAV_COMMANDS.filter((command) =>
          command.name.startsWith(slash.query.toLocaleLowerCase()),
        )
      : [];
  // Enabled skills surface here as prompt helpers: Droid has no
  // native skill-invocation RPC (`userInvocable` exists on SkillInfo
  // but no channel executes it), so selecting one inserts guiding
  // text instead of pretending to run the skill.
  const skillMatches =
    slash !== null
      ? skills.items
          .filter(
            (skill) =>
              skill.enabled &&
              skill.name
                .toLocaleLowerCase()
                .startsWith(slash.query.toLocaleLowerCase()),
          )
          .slice(0, MAX_SLASH_SKILL_MATCHES)
      : [];
  // One flat list drives keyboard navigation across the sections.
  const slashEntries: readonly SlashEntry[] = [
    ...builtInMatches.map(
      (command): SlashEntry => ({ kind: "builtin", ...command }),
    ),
    ...navMatches.map((command): SlashEntry => ({ kind: "nav", ...command })),
    ...commandMatches.map(
      (command): SlashEntry => ({ kind: "command", command }),
    ),
    ...skillMatches.map(
      (skill): SlashEntry => ({
        kind: "skill",
        name: skill.name,
        description: skill.description,
      }),
    ),
  ];
  // Built-ins are always available, so the popup shows whenever a
  // `/` token is active; the custom section keeps its own
  // loading/error/empty feedback rows.
  const slashVisible = slashOpen;

  // The active skill row surfaces its full description in a quiet
  // card above the popup (rows keep one line each). The card anchors
  // to the popup's viewport box through a portal, so no transformed
  // ancestor or the popup's own scroll clipping can displace it.
  const slashPopupRef = useRef<HTMLDivElement | null>(null);
  const activeSlashEntry = slashEntries[slashIndex];
  const slashTip =
    slashVisible &&
    activeSlashEntry !== undefined &&
    activeSlashEntry.kind === "skill" &&
    activeSlashEntry.description !== null &&
    activeSlashEntry.description.length > 0
      ? {
          name: activeSlashEntry.name,
          description: activeSlashEntry.description,
        }
      : null;
  const [slashTipBox, setSlashTipBox] = useState<{
    left: number;
    width: number;
    bottom: number;
  } | null>(null);
  const slashTipName = slashTip?.name;
  useEffect(() => {
    if (slashTipName === undefined) {
      setSlashTipBox(null);
      return;
    }
    const popup = slashPopupRef.current;
    if (popup === null) {
      setSlashTipBox(null);
      return;
    }
    const rect = popup.getBoundingClientRect();
    setSlashTipBox({
      left: rect.left,
      width: rect.width,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, [slashTipName]);

  const closeSlash = (): void => {
    setSlash(null);
    setSlashIndex(0);
  };

  const replaceSlash = (prefix: string): void => {
    if (slash === null) {
      return;
    }
    const next = prefix + draftRef.current.slice(slash.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeSlash();
  };

  /** Completes the draft to `/name ` without sending. */
  const selectCommand = (name: string): void => replaceSlash(`/${name} `);

  /** Replaces the `/` token with guiding text for one skill. */
  const selectSkillGuide = (name: string): void =>
    replaceSlash(`Use the "${name}" skill: `);

  /** Clears the `/` token and opens the target panel directly. */
  const selectSlashNav = (target: SlashNavTarget): void => {
    if (slash === null) {
      return;
    }
    const next = draftRef.current.slice(slash.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeSlash();
    onSlashNavigate?.(target);
  };

  /**
   * Clears the `/` token and opens the side-chat card. Direct like
   * the navigation rows (not a text completion), so the entry works
   * while a main turn is running and the composer cannot send.
   */
  const selectBtwOpen = (): void => {
    if (slash === null) {
      return;
    }
    const next = draftRef.current.slice(slash.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeSlash();
    onBtwOpen?.();
  };

  const selectSlashEntry = (entry: SlashEntry): void => {
    if (entry.kind === "skill") {
      selectSkillGuide(entry.name);
    } else if (entry.kind === "nav") {
      selectSlashNav(entry.name);
    } else if (entry.kind === "builtin" && entry.name === "btw") {
      selectBtwOpen();
    } else if (entry.kind === "builtin" && entry.name === "canvas") {
      replaceSlash(CANVAS_REQUEST_TEMPLATE);
    } else {
      selectCommand(
        entry.kind === "command" ? entry.command.name : entry.name,
      );
    }
  };

  // Debounce host searches while the user types the mention query.
  // An empty query still asks the host: it answers with the open
  // editor tabs so a bare `@` lists them immediately (no debounce).
  useEffect(() => {
    if (mention === null) {
      setActiveRequestId(null);
      return undefined;
    }
    const query = mention.query;
    const timer = setTimeout(
      () => {
        searchCounterRef.current += 1;
        const requestId = `file-search-${searchCounterRef.current}`;
        setActiveRequestId(requestId);
        onFileSearch(requestId, query);
      },
      query.length === 0 ? 0 : 150,
    );
    return () => clearTimeout(timer);
  }, [mention, onFileSearch]);

  const results =
    mention !== null &&
    activeRequestId !== null &&
    fileSearch !== null &&
    fileSearch.requestId === activeRequestId
      ? fileSearch.files
      : [];
  // True from popup open until the host answers the active search
  // request (covers the debounce window too).
  const searchPending =
    mention !== null &&
    (activeRequestId === null ||
      fileSearch === null ||
      fileSearch.requestId !== activeRequestId);

  const closeMention = (): void => {
    setMention(null);
    setActiveRequestId(null);
    setActiveIndex(0);
  };

  const selectMention = (path: string): void => {
    if (mention === null) {
      return;
    }
    onAttachPath(path);
    const draft = draftRef.current;
    const next = draft.slice(0, mention.start) + draft.slice(mention.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeMention();
  };

  return (
    <div className="dvx-composer-wrap">
      <div className="dvx-composer-seam" aria-hidden="true" />
      <ComposerPrimitive.Root
        className={`dvx-composer${
          interactionPending ? " dvx-composer-pending" : ""
        }${dragActive ? " dvx-composer-dragover" : ""}`}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (
            types.includes("Files") ||
            types.includes("text/uri-list") ||
            types.includes("application/vnd.code.uri-list")
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          setDragActive(false);
          if (handleComposerDrop(event.dataTransfer)) {
            event.preventDefault();
          }
        }}
      >
        {attachments.length > 0 && !interactionPending ? (
          <div
            className="dvx-attachment-chips"
            aria-label="Pending attachments"
          >
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={onAttachmentRemove}
              />
            ))}
          </div>
        ) : null}
        {interactionPending ? null : (
          <>
            <label className="dvx-visually-hidden" htmlFor="dvx-prompt">
              Message Droid
            </label>
            {slashVisible ? (
              <ComposerPopup
                className="dvx-mention-popup dvx-command-popup"
                label="Droid commands"
                onDismiss={closeSlash}
                popupRef={slashPopupRef}
              >
                {builtInMatches.length + navMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Built-in
                  </div>
                ) : null}
                {builtInMatches.map((command, index) => (
                  <button
                    key={`builtin:${command.name}`}
                    type="button"
                    role="option"
                    aria-selected={index === slashIndex}
                    className={`dvx-mention-item${
                      index === slashIndex ? " dvx-mention-active" : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectSlashEntry({ kind: "builtin", ...command });
                    }}
                    onMouseEnter={() => setSlashIndex(index)}
                  >
                    <span className="dvx-command-name">/{command.name}</span>
                    <span className="dvx-command-desc">
                      {command.description}
                    </span>
                  </button>
                ))}
                {navMatches.map((command, index) => (
                  <button
                    key={`nav:${command.name}`}
                    type="button"
                    role="option"
                    aria-selected={
                      builtInMatches.length + index === slashIndex
                    }
                    className={`dvx-mention-item${
                      builtInMatches.length + index === slashIndex
                        ? " dvx-mention-active"
                        : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectSlashNav(command.name);
                    }}
                    onMouseEnter={() =>
                      setSlashIndex(builtInMatches.length + index)
                    }
                  >
                    <span className="dvx-command-name">/{command.name}</span>
                    <span className="dvx-command-desc">
                      {command.description}
                    </span>
                  </button>
                ))}
                {commandMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Commands (.factory/commands)
                  </div>
                ) : null}
                {commandMatches.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    role="option"
                    aria-selected={
                      builtInMatches.length + navMatches.length + index ===
                      slashIndex
                    }
                    className={`dvx-mention-item${
                      builtInMatches.length + navMatches.length + index ===
                      slashIndex
                        ? " dvx-mention-active"
                        : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectCommand(command.name);
                    }}
                    onMouseEnter={() =>
                      setSlashIndex(
                        builtInMatches.length + navMatches.length + index,
                      )
                    }
                  >
                    <span className="dvx-command-name">/{command.name}</span>
                    {command.argumentHint !== null ? (
                      <span className="dvx-command-hint">
                        {command.argumentHint}
                      </span>
                    ) : null}
                    {command.description !== null ? (
                      <span className="dvx-command-desc">
                        {command.description}
                      </span>
                    ) : null}
                  </button>
                ))}
                {commandMatches.length === 0 &&
                (slash?.query.length === 0 ||
                  builtInMatches.length +
                    navMatches.length +
                    skillMatches.length ===
                    0) ? (
                  <div className="dvx-command-status" role="status">
                    {commands.status === "loading"
                      ? "Loading commands…"
                      : commands.status === "error"
                        ? commands.message
                        : slash !== null && slash.query.length === 0
                          ? "No custom commands (.factory/commands)"
                          : "No matching commands"}
                  </div>
                ) : null}
                {skillMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Skills (inserts a prompt)
                  </div>
                ) : null}
                {skillMatches.map((skill, index) => (
                  <button
                    key={`skill:${skill.name}`}
                    type="button"
                    role="option"
                    aria-selected={
                      builtInMatches.length +
                        navMatches.length +
                        commandMatches.length +
                        index ===
                      slashIndex
                    }
                    className={`dvx-mention-item${
                      builtInMatches.length +
                        navMatches.length +
                        commandMatches.length +
                        index ===
                      slashIndex
                        ? " dvx-mention-active"
                        : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectSkillGuide(skill.name);
                    }}
                    onMouseEnter={() =>
                      setSlashIndex(
                        builtInMatches.length +
                          navMatches.length +
                          commandMatches.length +
                          index,
                      )
                    }
                  >
                    <span className="dvx-command-name">{skill.name}</span>
                    {skill.description !== null ? (
                      <span className="dvx-command-desc">
                        {skill.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </ComposerPopup>
            ) : null}
            {slashTip !== null && slashTipBox !== null
              ? createPortal(
                  <div
                    className="dvx-slash-tooltip"
                    role="tooltip"
                    style={{
                      left: slashTipBox.left,
                      width: slashTipBox.width,
                      bottom: slashTipBox.bottom,
                    }}
                  >
                    <strong>{slashTip.name}</strong>
                    <span className="dvx-slash-tooltip-kind">
                      Skill · inserts a prompt
                    </span>
                    <p>{slashTip.description}</p>
                  </div>,
                  document.body,
                )
              : null}
            {mention !== null ? (
              <ComposerPopup
                className="dvx-mention-popup"
                label="Attach workspace file"
                onDismiss={closeMention}
              >
                {mention.query.length === 0 && results.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Open editors
                  </div>
                ) : null}
                {results.map((path, index) => {
                  const { name, directory } = splitMentionPath(path);
                  return (
                    <button
                      key={path}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`dvx-mention-item${
                        index === activeIndex ? " dvx-mention-active" : ""
                      }`}
                      title={path}
                      onMouseDown={(event) => {
                        // Keep focus in the textarea while selecting.
                        event.preventDefault();
                        selectMention(path);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className="dvx-mention-name">{name}</span>
                      {directory.length > 0 ? (
                        <span className="dvx-mention-path">{directory}</span>
                      ) : null}
                    </button>
                  );
                })}
                {results.length === 0 ? (
                  <div className="dvx-command-status" role="status">
                    {searchPending
                      ? "Searching files…"
                      : activeRequestId !== null &&
                          fileSearch?.requestId === activeRequestId &&
                          fileSearch.status === "no-workspace"
                        ? "No folder is open in this window."
                        : mention.query.length === 0
                          ? "No open editors — type to search files"
                          : "No matching files"}
                  </div>
                ) : null}
              </ComposerPopup>
            ) : null}
            <ComposerPrimitive.Input
              id="dvx-prompt"
              className="dvx-composer-input"
              placeholder={
                settings.value?.interactionMode === "spec"
                  ? "Describe what to plan…"
                  : "Ask Droid about your workspace"
              }
              rows={1}
              maxLength={MAX_TURN_TEXT_LENGTH}
              submitMode="enter"
              addAttachmentOnPaste={false}
              onPaste={(event) => {
                // Rich clipboard payloads can expose both text and an
                // image. Preserve native text paste in that case; only
                // image-only payloads should become attachments.
                const text =
                  event.clipboardData?.getData("text/plain") ?? "";
                if (text.length > 0) {
                  return;
                }
                const files = Array.from(
                  event.clipboardData?.files ?? [],
                ).filter((file) => isImageMediaType(file.type));
                if (files.length > 0) {
                  event.preventDefault();
                  stageDroppedFiles(files);
                }
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                draftRef.current = value;
                onDraftChange(value);
                const caret =
                  event.currentTarget.selectionStart ?? value.length;
                const nextMention = findMentionToken(value, caret);
                setMention(nextMention);
                setActiveIndex(0);
                setSlash(findSlashToken(value, caret));
                setSlashIndex(0);
              }}
              onKeyDown={(event) => {
                if (slashVisible) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSlash();
                    return;
                  }
                  if (slashEntries.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSlashIndex(
                        (index) => (index + 1) % slashEntries.length,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSlashIndex(
                        (index) =>
                          (index - 1 + slashEntries.length) %
                          slashEntries.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      const entry = slashEntries[slashIndex];
                      if (entry !== undefined) {
                        selectSlashEntry(entry);
                      }
                      return;
                    }
                  }
                }
                // assistant-ui's input swallows Enter while the
                // thread is running (its built-in queue capability is
                // off for external-store runtimes), so route the
                // enqueue through the composer send pipeline here.
                // The full-queue guard keeps the draft in place when
                // nothing can be queued — except in "Edit Queued"
                // mode, where the send replaces an existing prompt.
                if (
                  mention === null &&
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  (queueEditing ||
                    ((running || stopping || queuedCount > 0) &&
                      queuedCount < MAX_QUEUED_MESSAGES))
                ) {
                  event.preventDefault();
                  aui.thread.composer().send();
                  return;
                }
                if (mention === null) {
                  if (queueEditing && event.key === "Escape") {
                    event.preventDefault();
                    onQueueEditCancel?.();
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMention();
                  return;
                }
                if (results.length === 0) {
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % results.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index - 1 + results.length) % results.length,
                  );
                } else if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  const path = results[activeIndex];
                  if (path !== undefined) {
                    selectMention(path);
                  }
                }
              }}
            />
          </>
        )}
        {dropNotice !== null && !interactionPending ? (
          <div className="dvx-composer-notice" role="status">
            {dropNotice}
          </div>
        ) : null}
        {statusMessage !== undefined && !interactionPending ? (
          <div className="dvx-composer-status" aria-live="polite">
            {statusMessage}
          </div>
        ) : null}
        <div className="dvx-composer-footer">
          {queueEditing ? (
            <span className="dvx-queue-edit-chip">
              Edit Queued
              <button
                type="button"
                className="dvx-queue-edit-chip-cancel"
                aria-label="Cancel editing the queued message"
                title="Cancel edit"
                onClick={onQueueEditCancel}
              >
                ×
              </button>
            </span>
          ) : null}
          <ComposerControls
            settings={settings}
            context={context}
            tokenUsage={tokenUsage}
            modelCatalog={modelCatalog}
            skills={skills}
            mcp={mcp}
            plugins={plugins}
            disabled={controlsDisabled}
            settingUpdatesDisabled={settingUpdatesDisabled}
            onContextRefresh={onContextRefresh}
            compactPending={compactPending}
            onCompact={onCompact}
            onSettingUpdate={onSettingUpdate}
            missionActive={missionActive}
            onMissionOpen={onMissionOpen}
            onSkillsRefresh={onSkillsRefresh}
            onSkillToggle={onSkillToggle}
            onMcpRefresh={onMcpRefresh}
            onMcpServerToggle={onMcpServerToggle}
            onMcpServerAdd={onMcpServerAdd}
            onMcpServerRemove={onMcpServerRemove}
            mcpAuth={mcpAuth}
            onMcpServerAuthenticate={onMcpServerAuthenticate}
            onPluginsRefresh={onPluginsRefresh}
            navSignal={navSignal}
            onNewSession={onNewSession}
            onAttachFiles={onAttachFiles}
            onAttachEditor={onAttachEditor}
            onAttachSelection={onAttachSelection}
            onAttachProblems={onAttachProblems}
            onAttachGitChanges={onAttachGitChanges}
          />
          {showRetry ? (
            <button
              className="dvx-composer-action"
              type="button"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : stopping || (!running && queuedCount > 0) ? (
            <ComposerSendButton
              onSend={() => aui.thread.composer().send()}
            />
          ) : running ? (
            <ComposerPrimitive.Cancel
              className="dvx-composer-action dvx-stop-action"
            >
              Stop
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerSendButton />
          )}
        </div>
      </ComposerPrimitive.Root>
      <div className="dvx-composer-hint">
        {queueEditing
          ? "Editing a queued message · Enter saves · Esc cancels"
          : queuedCount >= MAX_QUEUED_MESSAGES
            ? `Queue is full (${MAX_QUEUED_MESSAGES}) · Remove a queued message to add another`
            : interactionPending
              ? "Pending request · Complete the action above"
              : stopping
                ? "Stopping · Enter sends next when this turn stops"
                : running
                ? "Droid is active · Enter queues for after this turn"
                : queuedCount > 0
                  ? "Enter adds to the queue · Shift+Enter for a new line"
                  : "Enter to send · Shift+Enter for a new line"}
      </div>
    </div>
  );
}

export { ATTACHMENT_KIND_LABELS, AttachmentChip } from "./AttachmentChip";

export const MAX_ATTACHMENT_IMAGE_BYTES = 4 * 1024 * 1024;

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * Extracts bounded `file://` URIs from a drop. Editor explorer drags
 * populate `text/uri-list` (newline separated, `#` comments) and
 * sometimes `application/vnd.code.uri-list` (JSON array); anything
 * that is not a file URI is dropped here before crossing the bridge.
 */
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
  return entries.filter(
    (uri) =>
      uri.startsWith("file://") && uri.length <= MAX_ATTACHMENT_URI_LENGTH,
  );
}

/**
 * Reads one image file into raw base64 for the `attachment.addImage`
 * bridge message. Returns null when the read fails or the result is
 * not the expected data-URI shape.
 */
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
