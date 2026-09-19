import { SlashCommandPopup } from './SlashCommandPopup';
import { type ThreadComposerProps } from './composerTypes';
import { type ThreadTranscriptProps } from '../thread/threadProps';
// Composer: moved verbatim from Thread.tsx (structure-only refactor).

import { ComposerPrimitive, useAui } from '@assistant-ui/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { MAX_ATTACHMENT_IMAGE_BYTES } from '../../../shared/bridgeMessages';
import {
  MAX_ATTACHMENT_URI_COUNT,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
} from '../../../shared/protocol/bounds';
import { MAX_QUEUED_MESSAGES } from '../../../shared/protocol/queueProtocol';
import { AttachmentChip } from '../attachments/AttachmentChip';
import {
  isImageMediaType,
  prepareAttachment,
  readDroppedFileUris,
  readDroppedRemoteImageUrl,
} from '../attachments/attachmentIngress';
import { rememberImagePreview } from '../attachments/imagePreviewCache';
import {
  getSlashMatches,
  findMentionToken,
  findSlashToken,
  splitMentionPath,
  type MentionToken,
  type SlashEntry,
  type SlashToken,
} from './composerCommands';
import { ComposerControls } from './ComposerControls';
import { ComposerPopup } from './ComposerPopup';
import { ComposerSendButton } from './ComposerSendButton';
import {
  CANVAS_REQUEST_TEMPLATE,
  type SlashNavTarget,
} from './slashBuiltins';

function ComposerQuotePreview(): React.JSX.Element {
  return (
    <ComposerPrimitive.Quote className="dvx-composer-quote">
      <ComposerPrimitive.QuoteText className="dvx-composer-quote-text" />
      <ComposerPrimitive.QuoteDismiss
        className="dvx-composer-quote-dismiss"
        aria-label="Remove quoted context"
      >
        ×
      </ComposerPrimitive.QuoteDismiss>
    </ComposerPrimitive.Quote>
  );
}

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
  attachmentImages,
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
  onAttachPdf,
  onAttachRemoteImage,
  onAttachUris,
  onAttachTextFile,
  onAttachmentReadImage,
  onAttachmentReplaceImage,
  onAttachmentRemove,
  onDraftChange,
  queuedCount = 0,
  queueEditing = false,
  onQueueEditCancel,
}: ThreadComposerProps &
  Pick<
    ThreadTranscriptProps,
    | 'statusMessage'
    | 'showRetry'
    | 'running'
    | 'stopping'
    | 'interactionPending'
    | 'onRetry'
  >): React.JSX.Element {
  const aui = useAui();
  const draftRef = useRef('');
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
  const stageDroppedFiles = (files: readonly File[]): void => {
    const remaining = Math.max(0, MAX_PENDING_ATTACHMENTS - attachments.length);
    if (files.length > remaining)
      showDropNotice(
        `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
      );
    for (const file of files.slice(0, remaining)) {
      void prepareAttachment(file).then((prepared) => {
        switch (prepared.kind) {
          case 'notice':
            showDropNotice(prepared.message);
            break;
          case 'image':
            rememberImagePreview(
              prepared.name,
              file.size,
              `data:${prepared.mediaType};base64,${prepared.data}`,
            );
            onAttachImage(prepared.name, prepared.mediaType, prepared.data);
            break;
          case 'pdf':
            onAttachPdf(prepared.name, prepared.data);
            break;
          case 'text':
            onAttachTextFile(prepared.name, prepared.text, prepared.truncated);
            break;
        }
      });
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
      onAttachUris(uris.slice(0, Math.min(remaining, MAX_ATTACHMENT_URI_COUNT)));
      return true;
    }
    const files = Array.from(dataTransfer.files);
    if (files.length > 0) {
      stageDroppedFiles(files);
      return true;
    }
    const remoteImageUrl = readDroppedRemoteImageUrl(dataTransfer);
    if (remoteImageUrl !== null) {
      onAttachRemoteImage(remoteImageUrl);
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
      if (commandsStatus === 'idle' || commandsStatus === 'error') {
        onCommandsRefresh();
      }
      if (skillsStatus === 'idle') {
        onSkillsRefresh();
      }
    }
    // Refetch only on open/close and connection transitions.
  }, [slashOpen, controlsDisabled]);

  const { commandMatches, builtInMatches, navMatches, skillMatches, entries: slashEntries } =
    getSlashMatches(commands, skills.items, slash, btwAvailable, onSlashNavigate !== undefined);
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
    activeSlashEntry.kind === 'skill' &&
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
    if (entry.kind === 'skill') {
      selectSkillGuide(entry.name);
    } else if (entry.kind === 'nav') {
      selectSlashNav(entry.name);
    } else if (entry.kind === 'builtin' && entry.name === 'btw') {
      selectBtwOpen();
    } else if (entry.kind === 'builtin' && entry.name === 'canvas') {
      replaceSlash(CANVAS_REQUEST_TEMPLATE);
    } else {
      selectCommand(entry.kind === 'command' ? entry.command.name : entry.name);
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
          interactionPending ? ' dvx-composer-pending' : ''
        }${dragActive ? ' dvx-composer-dragover' : ''}`}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (
            types.includes('Files') ||
            types.includes('text/uri-list') ||
            types.includes('application/vnd.code.uri-list') ||
            types.includes('text/html')
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
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
        {interactionPending ? null : <ComposerQuotePreview />}
        {attachments.length > 0 && !interactionPending ? (
          <div className="dvx-attachment-chips" aria-label="Pending attachments">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                image={attachmentImages[attachment.id]}
                onRequestImage={onAttachmentReadImage}
                onReplaceImage={onAttachmentReplaceImage}
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
              <SlashCommandPopup
                builtInMatches={builtInMatches}
                navMatches={navMatches}
                commandMatches={commandMatches}
                skillMatches={skillMatches}
                slashIndex={slashIndex}
                setSlashIndex={setSlashIndex}
                selectSlashEntry={selectSlashEntry}
                selectSlashNav={selectSlashNav}
                selectCommand={selectCommand}
                selectSkillGuide={selectSkillGuide}
                closeSlash={closeSlash}
                slashPopupRef={slashPopupRef}
                commands={commands}
                slash={slash}
              />
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
                        index === activeIndex ? ' dvx-mention-active' : ''
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
                      ? 'Searching files…'
                      : activeRequestId !== null &&
                          fileSearch?.requestId === activeRequestId &&
                          fileSearch.status === 'no-workspace'
                        ? 'No folder is open in this window.'
                        : mention.query.length === 0
                          ? 'No open editors — type to search files'
                          : 'No matching files'}
                  </div>
                ) : null}
              </ComposerPopup>
            ) : null}
            <ComposerPrimitive.Input
              id="dvx-prompt"
              className="dvx-composer-input"
              placeholder={
                settings.value?.interactionMode === 'spec'
                  ? 'Describe what to plan…'
                  : 'Ask Droid about your workspace'
              }
              rows={1}
              maxLength={MAX_TURN_TEXT_LENGTH}
              submitMode="enter"
              addAttachmentOnPaste={false}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files ?? []).filter(
                  (file) => isImageMediaType(file.type),
                );
                if (files.length > 0) {
                  // Keep native text insertion when rich clipboard data
                  // carries both text and images.
                  if ((event.clipboardData?.getData('text/plain') ?? '').length === 0) {
                    event.preventDefault();
                  }
                  stageDroppedFiles(files);
                }
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                draftRef.current = value;
                onDraftChange(value);
                const caret = event.currentTarget.selectionStart ?? value.length;
                const nextMention = findMentionToken(value, caret);
                setMention(nextMention);
                setActiveIndex(0);
                setSlash(findSlashToken(value, caret));
                setSlashIndex(0);
              }}
              onKeyDown={(event) => {
                if (slashVisible) {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSlash();
                    return;
                  }
                  if (slashEntries.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setSlashIndex((index) => (index + 1) % slashEntries.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setSlashIndex(
                        (index) =>
                          (index - 1 + slashEntries.length) % slashEntries.length,
                      );
                      return;
                    }
                    if (event.key === 'Enter' || event.key === 'Tab') {
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
                  event.key === 'Enter' &&
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
                  if (queueEditing && event.key === 'Escape') {
                    event.preventDefault();
                    onQueueEditCancel?.();
                  }
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeMention();
                  return;
                }
                if (results.length === 0) {
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % results.length);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index - 1 + results.length) % results.length,
                  );
                } else if (event.key === 'Enter' || event.key === 'Tab') {
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
            <button className="dvx-composer-action" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : stopping || (!running && queuedCount > 0) ? (
            <ComposerSendButton onSend={() => aui.thread.composer().send()} />
          ) : running ? (
            <ComposerPrimitive.Cancel
              className="dvx-composer-action dvx-stop-action"
              aria-label="Stop Droid"
              title="Stop"
            >
              <span aria-hidden="true">■</span>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerSendButton />
          )}
        </div>
      </ComposerPrimitive.Root>
      <div className="dvx-composer-hint">
        {queueEditing
          ? 'Editing a queued message · Enter saves · Esc cancels'
          : queuedCount >= MAX_QUEUED_MESSAGES
            ? `Queue is full (${MAX_QUEUED_MESSAGES}) · Remove a queued message to add another`
            : interactionPending
              ? 'Pending request · Complete the action above'
              : stopping
                ? 'Stopping · Enter sends next when this turn stops'
                : running
                  ? 'Droid is active · Enter queues for after this turn'
                  : queuedCount > 0
                    ? 'Enter adds to the queue · Shift+Enter for a new line'
                    : 'Enter to send · Shift+Enter for a new line'}
      </div>
    </div>
  );
}

export { ATTACHMENT_KIND_LABELS, AttachmentChip } from '../attachments/AttachmentChip';

export { MAX_ATTACHMENT_IMAGE_BYTES };
