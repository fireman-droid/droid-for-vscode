import { ThreadPrimitive } from '@assistant-ui/react';
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SelectionQuoteToolbar } from '../btw/SelectionQuoteToolbar';
import { Composer } from '../composer/Composer';
import type { UserEditorEnv } from '../editing/userEditorEnv';
import { useMessageEditor } from '../editing/useMessageEditor';
import { ProcessConversationContext } from '../transcript/processPresentation';
import {
  InlineHtmlPreviewContext,
  PathPreviewContext,
  type PathPreviewWiring,
} from '../markdown/MarkdownText';
import { TransientNotice } from '../shell/transientNotice';
import type { TranscriptVirtualizerApi } from './buildTurns';
import { ScrollToBottomIcon } from './icons';
import { ThreadMessageChromeContext, type ThreadMessageChrome } from './messageChrome';
import {
  FileDiffContext,
  ForkContext,
  PreviewContext,
  RegenerateContext,
  ReviewTurnContext,
  SelectSessionContext,
  TerminalMirrorContext,
} from './messageContexts';
import {
  applyFollowScroll,
  applyFollowWheelIntent,
  createFollowState,
} from './navigation/followScroll';
import { QuestionNavigator } from './navigation/QuestionNavigator';
import { SCROLL_BOTTOM_SHOW_PX } from './navigation/stickyLayout';
import { useQuestionNavigation } from './navigation/useQuestionNavigation';
import { type DroidThreadProps } from './threadProps';
import { HistoryNotice, PendingResponse } from './transcriptRows';
import { VirtualizedMessages } from './VirtualizedMessages';

export const DroidThread = memo(function DroidThread(
  props: DroidThreadProps,
): React.JSX.Element {
  const transcript = props.transcript;
  const { planAnchors = null } = transcript;
  const composer = props.composer;
  const { queueEditing = false } = composer;
  const messageActions = props.messageActions;
  const slots = props.slots;
  const {
    queuedMessages = null,
    missionSetup = null,
    reviewDock = null,
    transientDiagnostic = null,
  } = slots;

  const conversationId = useContext(ProcessConversationContext);
  const followRef = useRef(createFollowState());
  const prepareEditing = useCallback((): void => {
    followRef.current.following = false;
    if (queueEditing) composer.onQueueEditCancel?.();
  }, [queueEditing, composer.onQueueEditCancel]);
  const editor = useMessageEditor({
    conversationId,
    sendSignal: messageActions.sendSignal,
    rejection: messageActions.editResendRejection,
    onBegin: prepareEditing,
    onStageBegin: messageActions.onEditStageBegin,
    onStageCancel: messageActions.onEditStageCancel,
    onRequestRewindInfo: messageActions.onRequestRewindInfo,
    onResend: messageActions.onEditResend,
  });
  // Stick-to-bottom is owned here because the primitive's autoScroll
  // is disabled: its isAtBottom latch loses a race between async
  // scroll events and fast streaming growth, see applyFollowScroll).
  //
  // The scroll-to-bottom arrow shares the coordinator's rAF pass so
  // its visibility can never disagree with the follow state, and its
  // click re-latches `follow.following` rather than owning any
  // scroll state of its own.
  const readingColumnRef = useRef<HTMLDivElement | null>(null);
  const virtualizerApiRef = useRef<TranscriptVirtualizerApi | null>(null);
  const questionNavigation = useQuestionNavigation(readingColumnRef, virtualizerApiRef);
  const historyRevealAnchorRef = useRef<{
    readonly scrollHeight: number;
    readonly scrollTop: number;
  } | null>(null);
  const lastFollowSendSignalRef = useRef(messageActions.sendSignal);
  const revealEarlier = (): void => {
    const column = readingColumnRef.current;
    const scroller = column?.closest('.dvx-thread-viewport');
    historyRevealAnchorRef.current =
      scroller instanceof HTMLElement
        ? {
            scrollHeight: scroller.scrollHeight,
            scrollTop: scroller.scrollTop,
          }
        : null;
    transcript.onShowEarlier();
  };
  useLayoutEffect(() => {
    const anchor = historyRevealAnchorRef.current;
    historyRevealAnchorRef.current = null;
    const column = readingColumnRef.current;
    const scroller = column?.closest('.dvx-thread-viewport');
    if (anchor === null || !(scroller instanceof HTMLElement)) {
      return;
    }
    // History is prepended above the current reading position. Offset
    // by exactly that growth so the latest exchange cannot appear to
    // vanish or jump when older messages mount.
    scroller.scrollTop = anchor.scrollTop + (scroller.scrollHeight - anchor.scrollHeight);
  }, [transcript.hiddenMessageCount]);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollToBottomRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (lastFollowSendSignalRef.current === messageActions.sendSignal) {
      return;
    }
    lastFollowSendSignalRef.current = messageActions.sendSignal;
    if (queueEditing) {
      return;
    }
    const column = readingColumnRef.current;
    const scroller = column?.closest('.dvx-thread-viewport');
    if (!(scroller instanceof HTMLElement)) {
      return;
    }
    const follow = followRef.current;
    const maxTop = scroller.scrollHeight - scroller.clientHeight;
    follow.following = true;
    follow.pendingProgrammaticTop = maxTop;
    scroller.scrollTop = maxTop;
  }, [queueEditing, messageActions.sendSignal]);
  useEffect(() => {
    const column = readingColumnRef.current;
    if (column === null) {
      return undefined;
    }
    const scroller = column.closest('.dvx-thread-viewport');
    if (!(scroller instanceof HTMLElement)) {
      return undefined;
    }
    let frame = 0;
    const follow = followRef.current;
    const updateScrollState = (): void => {
      frame = 0;
      const awayFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >
        SCROLL_BOTTOM_SHOW_PX;
      setAwayFromBottom(awayFromBottom);
    };
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(updateScrollState);
      }
    };
    // Content growth (streaming rows, CSS height transitions, composer
    // resizes) glues the viewport to the bottom while following. The
    // write is marked so the resulting scroll event is never mistaken
    // for a user scroll.
    const followBottom = (): void => {
      if (follow.following) {
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        if (scroller.scrollTop < maxTop - 0.5) {
          follow.pendingProgrammaticTop = maxTop;
          scroller.scrollTop = maxTop;
        }
      }
      schedule();
    };
    const onScroll = (): void => {
      applyFollowScroll(follow, {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
      schedule();
    };
    // Wheel/touchpad intent wins in both directions. Slow downward
    // reading must not race ResizeObserver and get pulled backward.
    const onWheel = (event: WheelEvent): void => {
      applyFollowWheelIntent(follow, event.deltaY, {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
    };
    // The arrow's click: re-latch the follow state first so any
    // streaming growth during the (possibly smooth) descent keeps
    // gluing, and mark the write as programmatic for the latch.
    scrollToBottomRef.current = () => {
      follow.following = true;
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      follow.pendingProgrammaticTop = maxTop;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({
        top: maxTop,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      schedule();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', onWheel, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(followBottom);
    resizeObserver?.observe(column);
    resizeObserver?.observe(scroller);
    const mutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutationObserver?.observe(column, { childList: true, subtree: true });
    updateScrollState();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', onWheel);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
  const editorEnv = useMemo<UserEditorEnv>(
    () => ({
      settings: composer.settings,
      context: composer.context,
      modelCatalog: composer.modelCatalog,
      skills: composer.skills,
      mcp: composer.mcp,
      plugins: composer.plugins,
      mcpAuth: composer.mcpAuth,
      controlsDisabled: composer.controlsDisabled,
      settingUpdatesDisabled: composer.settingUpdatesDisabled,
      onContextRefresh: composer.onContextRefresh,
      onCompact: composer.onCompact,
      onSettingUpdate: composer.onSettingUpdate,
      onSkillsRefresh: composer.onSkillsRefresh,
      onSkillToggle: composer.onSkillToggle,
      onMcpRefresh: composer.onMcpRefresh,
      onMcpServerToggle: composer.onMcpServerToggle,
      onMcpServerAdd: composer.onMcpServerAdd,
      onMcpServerRemove: composer.onMcpServerRemove,
      onMcpServerAuthenticate: composer.onMcpServerAuthenticate,
      onPluginsRefresh: composer.onPluginsRefresh,
      onAttachFiles: messageActions.onEditAttachFiles,
      onAttachEditor: messageActions.onEditAttachEditor,
      onAttachSelection: messageActions.onEditAttachSelection,
      onAttachProblems: messageActions.onEditAttachProblems,
      onAttachGitChanges: messageActions.onEditAttachGitChanges,
      onAttachImage: messageActions.onEditAttachImage,
      onAttachPdf: messageActions.onEditAttachPdf,
      onAttachRemoteImage: messageActions.onEditAttachRemoteImage,
      onAttachUris: messageActions.onEditAttachUris,
      onAttachTextFile: messageActions.onEditAttachTextFile,
      attachmentImages: composer.attachmentImages,
      onAttachmentReadImage: composer.onAttachmentReadImage,
      onAttachmentReplaceImage: composer.onAttachmentReplaceImage,
      onAttachmentRemove: messageActions.onEditAttachmentRemove,
    }),
    [
      composer.settings,
      composer.context,
      composer.modelCatalog,
      composer.skills,
      composer.mcp,
      composer.plugins,
      composer.mcpAuth,
      composer.controlsDisabled,
      composer.settingUpdatesDisabled,
      composer.onContextRefresh,
      composer.onCompact,
      composer.onSettingUpdate,
      composer.onSkillsRefresh,
      composer.onSkillToggle,
      composer.onMcpRefresh,
      composer.onMcpServerToggle,
      composer.onMcpServerAdd,
      composer.onMcpServerRemove,
      composer.onMcpServerAuthenticate,
      composer.onPluginsRefresh,
      messageActions.onEditAttachFiles,
      messageActions.onEditAttachEditor,
      messageActions.onEditAttachSelection,
      messageActions.onEditAttachProblems,
      messageActions.onEditAttachGitChanges,
      messageActions.onEditAttachImage,
      messageActions.onEditAttachPdf,
      messageActions.onEditAttachRemoteImage,
      messageActions.onEditAttachUris,
      messageActions.onEditAttachTextFile,
      composer.attachmentImages,
      composer.onAttachmentReadImage,
      composer.onAttachmentReplaceImage,
      messageActions.onEditAttachmentRemove,
    ],
  );
  const pathPreviewWiring = useMemo<PathPreviewWiring>(
    () => ({
      workspaceRoot: messageActions.workspaceRoot,
      previewFile: messageActions.onPreviewFile,
    }),
    [messageActions.workspaceRoot, messageActions.onPreviewFile],
  );
  const messageChrome = useMemo<ThreadMessageChrome>(
    () => ({
      planAnchors,
      running: transcript.running,
      activeTurnId: transcript.activeTurnId,
      editor,
      editStage: messageActions.editStage,
      rejection: messageActions.editResendRejection,
      editorEnv,
      editResendEnabled: messageActions.editResendEnabled,
      rewindInfo: messageActions.rewindInfo,
    }),
    [
      transcript.activeTurnId,
      messageActions.editResendEnabled,
      messageActions.editResendRejection,
      messageActions.editStage,
      editor,
      editorEnv,
      planAnchors,
      messageActions.rewindInfo,
      transcript.running,
    ],
  );
  const getScroller = useCallback((): HTMLElement | null => {
    const column = readingColumnRef.current;
    const scroller = column?.closest('.dvx-thread-viewport');
    return scroller instanceof HTMLElement ? scroller : null;
  }, []);
  const [messageOverlayHost, setMessageOverlayHost] = useState<HTMLDivElement | null>(
    null,
  );
  return (
    <ThreadPrimitive.Root
      className={`dvx-thread${transcript.interactionPending ? ' dvx-thread-pending' : ''}`}
    >
      <div className="dvx-thread-body">
        <div ref={setMessageOverlayHost} className="dvx-message-overlay-host" />
        <ThreadPrimitive.Viewport
          className="dvx-thread-viewport"
          aria-label="Chat transcript"
          // Continuous follow is owned by the coordinator above; the
          // primitive keeps only its one-shot scrolls (run start,
          // initialize, thread switch). See applyFollowScroll.
          autoScroll={false}
          turnAnchor="bottom"
          scrollToBottomOnRunStart
          scrollToBottomOnInitialize
          scrollToBottomOnThreadSwitch
        >
          <FileDiffContext.Provider value={messageActions.onOpenFileDiff}>
            <ReviewTurnContext.Provider value={messageActions.onOpenReviewTurn}>
              <PreviewContext.Provider value={messageActions.onPreviewFile}>
                <PathPreviewContext.Provider value={pathPreviewWiring}>
                  <InlineHtmlPreviewContext.Provider
                    value={messageActions.onPreviewInlineHtml}
                  >
                    <TerminalMirrorContext.Provider
                      value={messageActions.onOpenTerminalMirror}
                    >
                      <RegenerateContext.Provider value={messageActions.onRegenerate}>
                        <ForkContext.Provider value={messageActions.onForkSession}>
                          <SelectSessionContext.Provider
                            value={messageActions.onSelectSession}
                          >
                            <div className="dvx-reading-column" ref={readingColumnRef}>
                              <HistoryNotice
                                historyStatus={transcript.historyStatus}
                                truncated={transcript.truncated}
                              />
                              {transcript.hiddenMessageCount > 0 ? (
                                <button
                                  type="button"
                                  className="dvx-show-earlier"
                                  onClick={revealEarlier}
                                >
                                  Show earlier messages ({transcript.hiddenMessageCount}{' '}
                                  hidden)
                                </button>
                              ) : null}
                              <ThreadPrimitive.Empty>
                                <div className="dvx-empty-state">
                                  <h2>Ready in your workspace</h2>
                                  <p>
                                    {transcript.historyStatus === 'unavailable'
                                      ? 'Start a new message to continue this session.'
                                      : 'Ask Droid to explain, inspect, or change your code.'}
                                  </p>
                                </div>
                              </ThreadPrimitive.Empty>
                              <ThreadMessageChromeContext.Provider value={messageChrome}>
                                <VirtualizedMessages
                                  getScroller={getScroller}
                                  followingRef={followRef}
                                  apiRef={virtualizerApiRef}
                                  floatingHost={messageOverlayHost}
                                />
                              </ThreadMessageChromeContext.Provider>
                              {messageActions.onBtwQuote === undefined ? null : (
                                <SelectionQuoteToolbar
                                  onBtwQuote={messageActions.onBtwQuote}
                                />
                              )}
                              {transcript.pending ? (
                                <PendingResponse
                                  activity={transcript.activity}
                                  activityLive={transcript.activityLive}
                                />
                              ) : null}
                              {transientDiagnostic === null ? null : (
                                <TransientNotice
                                  key={transientDiagnostic.sequence}
                                  diagnostic={transientDiagnostic}
                                />
                              )}
                              {slots.inlineInteraction}
                            </div>
                          </SelectSessionContext.Provider>
                        </ForkContext.Provider>
                      </RegenerateContext.Provider>
                    </TerminalMirrorContext.Provider>
                  </InlineHtmlPreviewContext.Provider>
                </PathPreviewContext.Provider>
              </PreviewContext.Provider>
            </ReviewTurnContext.Provider>
          </FileDiffContext.Provider>
        </ThreadPrimitive.Viewport>
      </div>
      <div className="dvx-thread-footer">
        <div className="dvx-scroll-bottom-dock">
          <button
            type="button"
            className={
              awayFromBottom
                ? 'dvx-scroll-bottom dvx-scroll-bottom-visible'
                : 'dvx-scroll-bottom'
            }
            aria-label="Scroll to bottom"
            aria-hidden={!awayFromBottom}
            tabIndex={awayFromBottom ? 0 : -1}
            onClick={() => scrollToBottomRef.current()}
          >
            <ScrollToBottomIcon />
          </button>
        </div>
        {reviewDock}
        {/* Conversation-state bar family: the queue bar sits
              directly above the Composer, sharing the warm card
              language of the plan-era pins. */}
        {queuedMessages}
        {missionSetup}
        {slots.footerInteraction}
        <Composer
          {...composer}
          statusMessage={transcript.statusMessage}
          showRetry={transcript.showRetry}
          running={transcript.running}
          stopping={transcript.stopping}
          interactionPending={transcript.interactionPending}
          onRetry={transcript.onRetry}
        />
      </div>
      <QuestionNavigator
        visible={questionNavigation.visible}
        items={questionNavigation.items}
        activeIndex={questionNavigation.activeIndex}
        onNavigate={questionNavigation.navigate}
      />
    </ThreadPrimitive.Root>
  );
});

export type { UserEditorEnv } from '../editing/userEditorEnv';
export {
  FileDiffContext,
  ForkContext,
  PreviewContext,
  RegenerateContext,
  ReviewTurnContext,
  SelectSessionContext,
  TerminalMirrorContext,
  ToolChangesContext,
} from './messageContexts';
export {
  applyFollowScroll,
  applyFollowWheelIntent,
  createFollowState,
  FOLLOW_REJOIN_PX,
} from './navigation/followScroll';
export {
  computePinnedUserIndex,
  computeStickyLayout,
  shouldCompactStickyUser,
} from './navigation/stickyLayout';
export type {
  EditResendRejection,
  EditStageState,
  FileSearchResult,
  RewindFileInfo,
  SlashCommandsState,
} from './threadProps';
