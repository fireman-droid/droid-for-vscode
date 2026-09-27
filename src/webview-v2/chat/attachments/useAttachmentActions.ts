import { useCallback } from 'react';

import {
  type AttachmentStage,
  type WebviewToHostMessage,
} from '../../../shared/bridgeMessages';
import { type ImageMediaType } from '../../../shared/protocol/attachments';
import { getVsCodeApi } from '../../bridge/vscode';

type VsCodeApi = ReturnType<typeof getVsCodeApi>;

export function useAttachmentActions(
  vscode: VsCodeApi,
  sessionId: string | null,
  connectionStatus: string,
) {
  const connected = sessionId !== null && connectionStatus === 'connected';
  const post = useCallback(
    (message: WebviewToHostMessage): void => vscode.postMessage(message),
    [vscode],
  );
  const withSession = useCallback(
    (send: (activeSessionId: string) => void): void => {
      if (sessionId !== null) {
        send(sessionId);
      }
    },
    [sessionId],
  );
  const withConnectedSession = useCallback(
    (send: (activeSessionId: string) => void): void => {
      if (connected && sessionId !== null) {
        send(sessionId);
      }
    },
    [connected, sessionId],
  );

  const handleAttachPath = useCallback(
    (path: string): void =>
      withConnectedSession((id) =>
        post({ type: 'attachment.addPath', sessionId: id, path }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachFiles = useCallback(
    (): void => withSession((id) => post({ type: 'attachment.pick', sessionId: id })),
    [post, withSession],
  );
  const handleAttachEditor = useCallback(
    (): void =>
      withSession((id) => post({ type: 'attachment.addEditor', sessionId: id })),
    [post, withSession],
  );
  const handleAttachSelection = useCallback(
    (): void =>
      withSession((id) => post({ type: 'attachment.addSelection', sessionId: id })),
    [post, withSession],
  );
  const handleAttachProblems = useCallback(
    (): void =>
      withSession((id) => post({ type: 'attachment.addProblems', sessionId: id })),
    [post, withSession],
  );
  const handleAttachGitChanges = useCallback(
    (): void =>
      withSession((id) => post({ type: 'attachment.addGitChanges', sessionId: id })),
    [post, withSession],
  );
  const handleAttachImage = useCallback(
    (name: string, mediaType: ImageMediaType, dataBase64: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addImage',
          sessionId: id,
          name,
          mediaType,
          dataBase64,
        }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachPdf = useCallback(
    (name: string, dataBase64: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addPdf',
          sessionId: id,
          name,
          dataBase64,
        }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachRemoteImage = useCallback(
    (url: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addRemoteImage',
          sessionId: id,
          url,
        }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachUris = useCallback(
    (uris: readonly string[]): void => {
      if (uris.length > 0) {
        withConnectedSession((id) =>
          post({
            type: 'attachment.addUris',
            sessionId: id,
            uris,
          }),
        );
      }
    },
    [post, withConnectedSession],
  );
  const handleAttachTextFile = useCallback(
    (name: string, text: string, truncated: boolean): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addTextFile',
          sessionId: id,
          name,
          text,
          truncated,
        }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachmentRemove = useCallback(
    (attachmentId: string): void =>
      withSession((id) =>
        post({
          type: 'attachment.remove',
          sessionId: id,
          attachmentId,
        }),
      ),
    [post, withSession],
  );
  const handleEditStageBegin = useCallback(
    (messageId: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'editStage.begin',
          sessionId: id,
          messageId,
        }),
      ),
    [post, withConnectedSession],
  );
  const handleEditStageCancel = useCallback(
    (): void => withSession((id) => post({ type: 'editStage.cancel', sessionId: id })),
    [post, withSession],
  );
  const editSimple = useCallback(
    (
      type:
        | 'attachment.pick'
        | 'attachment.addEditor'
        | 'attachment.addSelection'
        | 'attachment.addProblems'
        | 'attachment.addGitChanges',
    ): void => withSession((id) => post({ type, sessionId: id, stage: 'edit' })),
    [post, withSession],
  );
  const handleEditAttachImage = useCallback(
    (name: string, mediaType: ImageMediaType, dataBase64: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addImage',
          sessionId: id,
          name,
          mediaType,
          dataBase64,
          stage: 'edit',
        }),
      ),
    [post, withConnectedSession],
  );
  const handleEditAttachPdf = useCallback(
    (name: string, dataBase64: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addPdf',
          sessionId: id,
          name,
          dataBase64,
          stage: 'edit',
        }),
      ),
    [post, withConnectedSession],
  );
  const handleEditAttachUris = useCallback(
    (uris: readonly string[]): void => {
      if (uris.length > 0) {
        withConnectedSession((id) =>
          post({
            type: 'attachment.addUris',
            sessionId: id,
            uris,
            stage: 'edit',
          }),
        );
      }
    },
    [post, withConnectedSession],
  );
  const handleEditAttachTextFile = useCallback(
    (name: string, text: string, truncated: boolean): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addTextFile',
          sessionId: id,
          name,
          text,
          truncated,
          stage: 'edit',
        }),
      ),
    [post, withConnectedSession],
  );
  const handleEditAttachRemoteImage = useCallback(
    (url: string): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.addRemoteImage',
          sessionId: id,
          url,
          stage: 'edit',
        }),
      ),
    [post, withConnectedSession],
  );
  const handleEditAttachmentRemove = useCallback(
    (attachmentId: string): void =>
      withSession((id) =>
        post({
          type: 'attachment.remove',
          sessionId: id,
          attachmentId,
          stage: 'edit',
        }),
      ),
    [post, withSession],
  );
  const handleAttachmentReadImage = useCallback(
    (attachmentId: string, stage?: AttachmentStage): void =>
      withConnectedSession((id) =>
        post({
          type: 'attachment.readImage',
          sessionId: id,
          attachmentId,
          ...(stage === undefined ? {} : { stage }),
        }),
      ),
    [post, withConnectedSession],
  );
  const handleAttachmentReplaceImage = useCallback(
    (
      attachmentId: string,
      name: string,
      mediaType: ImageMediaType,
      dataBase64: string,
      stage?: AttachmentStage,
    ): void =>
      withConnectedSession((id) => {
        post({
          type: 'attachment.addImage',
          sessionId: id,
          name,
          mediaType,
          dataBase64,
          replaceAttachmentId: attachmentId,
          ...(stage === undefined ? {} : { stage }),
        });
        post({
          type: 'attachment.readImage',
          sessionId: id,
          attachmentId,
          ...(stage === undefined ? {} : { stage }),
        });
      }),
    [post, withConnectedSession],
  );

  return {
    handleAttachPath,
    handleAttachFiles,
    handleAttachEditor,
    handleAttachSelection,
    handleAttachProblems,
    handleAttachGitChanges,
    handleAttachImage,
    handleAttachPdf,
    handleAttachRemoteImage,
    handleAttachUris,
    handleAttachTextFile,
    handleAttachmentRemove,
    handleEditStageBegin,
    handleEditStageCancel,
    handleEditAttachFiles: () => editSimple('attachment.pick'),
    handleEditAttachEditor: () => editSimple('attachment.addEditor'),
    handleEditAttachSelection: () => editSimple('attachment.addSelection'),
    handleEditAttachProblems: () => editSimple('attachment.addProblems'),
    handleEditAttachGitChanges: () => editSimple('attachment.addGitChanges'),
    handleEditAttachImage,
    handleEditAttachPdf,
    handleEditAttachRemoteImage,
    handleEditAttachUris,
    handleEditAttachTextFile,
    handleEditAttachmentRemove,
    handleAttachmentReadImage,
    handleAttachmentReplaceImage,
  };
}
