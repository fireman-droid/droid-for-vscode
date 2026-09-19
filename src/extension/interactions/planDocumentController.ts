import * as vscode from 'vscode';

import {
  MAX_EDITED_SPEC_LENGTH,
  type PermissionRespondMessage,
  type PlanDocumentOpenMessage,
} from '../../shared/bridgeMessages';
import { type PermissionInteractionRequest } from '../../shared/protocol/interactions';
import type {
  PlanDocumentGateway,
  PlanDocumentStateProjection,
} from './planDocumentGateway';

const PLAN_DOCUMENT_DEBOUNCE_MS = 120;

interface PendingPlanDocument {
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly initialContent: string;
  readonly editOption: PermissionInteractionRequest['options'][number];
  readonly defaultApprovalValue?: string;
  readonly negativeValues: ReadonlySet<string>;
  draft: string;
  document?: vscode.TextDocument;
  opening?: Promise<void>;
  debounce?: ReturnType<typeof setTimeout>;
  tooLarge: boolean;
}

/**
 * Owns the temporary Markdown editors for pending ExitSpecMode requests.
 * Documents stay under Cursor ownership after settlement; only their link to
 * the pending SDK approval is removed.
 */
export class PlanDocumentController implements PlanDocumentGateway {
  private readonly pending = new Map<string, PendingPlanDocument>();
  private readonly changeListener: vscode.Disposable;
  private readonly closeListener: vscode.Disposable;

  constructor(private readonly emit: (state: PlanDocumentStateProjection) => void) {
    this.changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      const entry = this.findDocument(event.document);
      if (entry !== undefined) {
        this.captureDocument(entry, event.document, true);
      }
    });
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      const entry = this.findDocument(document);
      if (entry === undefined) {
        return;
      }
      this.clearDebounce(entry);
      entry.document = undefined;
      this.emitState(entry, entry.tooLarge ? 'too-large' : 'closed');
    });
  }

  track(sessionId: string, turnId: string, request: PermissionInteractionRequest): void {
    if (this.pending.has(request.requestId)) {
      return;
    }
    const isPlan = request.tools.some(
      ({ confirmationKind }) => confirmationKind === 'exit_spec_mode',
    );
    const editOptions = request.options.filter(
      ({ requiresEditedSpec }) => requiresEditedSpec,
    );
    if (
      !isPlan ||
      request.editableSpecContent === undefined ||
      editOptions.length !== 1
    ) {
      return;
    }
    const initialContent = request.editableSpecContent;
    const negativeOptions = request.options.filter((option) =>
      /cancel|deny|reject/i.test(`${option.value} ${option.label}`),
    );
    const defaultApprovalValue = request.options.find(
      (option) => !option.requiresEditedSpec && !negativeOptions.includes(option),
    )?.value;
    this.pending.set(request.requestId, {
      sessionId,
      turnId,
      requestId: request.requestId,
      initialContent,
      editOption: editOptions[0]!,
      ...(defaultApprovalValue === undefined ? {} : { defaultApprovalValue }),
      negativeValues: new Set(negativeOptions.map(({ value }) => value)),
      draft: initialContent,
      tooLarge: false,
    });
  }

  open(message: PlanDocumentOpenMessage): void {
    const entry = this.pending.get(message.requestId);
    if (entry === undefined || !matches(entry, message)) {
      return;
    }
    if (entry.document !== undefined) {
      void this.showExistingDocument(entry);
      return;
    }
    if (entry.opening !== undefined) {
      return;
    }
    const opening = this.openDocument(entry);
    entry.opening = opening;
    void opening.finally(() => {
      if (this.pending.get(entry.requestId) === entry) {
        entry.opening = undefined;
      }
    });
  }

  prepareResponse(message: PermissionRespondMessage): PermissionRespondMessage | null {
    const entry = this.pending.get(message.requestId);
    if (entry === undefined) {
      return message;
    }
    if (!matches(entry, message)) {
      return null;
    }
    this.clearDebounce(entry);
    if (entry.document !== undefined) {
      this.captureDocument(entry, entry.document, false);
    }
    if (entry.negativeValues.has(message.selectedOption)) {
      return message;
    }
    if (entry.tooLarge) {
      this.emitState(entry, 'too-large');
      return null;
    }
    if (
      message.editedSpecContent !== undefined ||
      message.selectedOption !== entry.defaultApprovalValue ||
      entry.draft === entry.initialContent
    ) {
      return message;
    }
    return {
      type: 'permission.respond',
      sessionId: message.sessionId,
      turnId: message.turnId,
      requestId: message.requestId,
      selectedOption: entry.editOption.value,
      editedSpecContent: entry.draft,
    };
  }

  settle(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    this.clearDebounce(entry);
    this.pending.delete(requestId);
  }

  replay(): void {
    this.replayTo(this.emit);
  }

  replayTo(listener: (state: PlanDocumentStateProjection) => void): void {
    for (const entry of this.pending.values()) {
      if (entry.tooLarge) {
        listener(this.projectState(entry, 'too-large'));
      } else if (entry.document !== undefined || entry.draft !== entry.initialContent) {
        listener(this.projectState(entry, 'ready', entry.draft));
      }
    }
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      this.clearDebounce(entry);
    }
    this.pending.clear();
    this.changeListener.dispose();
    this.closeListener.dispose();
  }

  private async openDocument(entry: PendingPlanDocument): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: entry.draft,
      });
      if (this.pending.get(entry.requestId) !== entry) {
        return;
      }
      entry.document = document;
      entry.tooLarge = false;
      await vscode.window.showTextDocument(document, { preview: false });
      this.emitState(entry, 'ready', entry.draft);
    } catch {
      this.emitIfCurrent(entry, 'failed');
    }
  }

  private async showExistingDocument(entry: PendingPlanDocument): Promise<void> {
    try {
      await vscode.window.showTextDocument(entry.document!, {
        preview: false,
      });
    } catch {
      this.emitIfCurrent(entry, 'failed');
    }
  }

  private captureDocument(
    entry: PendingPlanDocument,
    document: vscode.TextDocument,
    debounce: boolean,
  ): void {
    const content = document.getText();
    entry.tooLarge = content.length > MAX_EDITED_SPEC_LENGTH;
    if (!entry.tooLarge) {
      entry.draft = content;
    }
    this.clearDebounce(entry);
    if (!debounce) {
      return;
    }
    entry.debounce = setTimeout(() => {
      entry.debounce = undefined;
      if (this.pending.get(entry.requestId) !== entry) {
        return;
      }
      if (entry.tooLarge) {
        this.emitState(entry, 'too-large');
      } else {
        this.emitState(entry, 'ready', entry.draft);
      }
    }, PLAN_DOCUMENT_DEBOUNCE_MS);
  }

  private findDocument(document: vscode.TextDocument): PendingPlanDocument | undefined {
    for (const entry of this.pending.values()) {
      if (entry.document === document) {
        return entry;
      }
    }
    return undefined;
  }

  private clearDebounce(entry: PendingPlanDocument): void {
    if (entry.debounce !== undefined) {
      clearTimeout(entry.debounce);
      entry.debounce = undefined;
    }
  }

  private emitIfCurrent(entry: PendingPlanDocument, status: 'failed'): void {
    if (this.pending.get(entry.requestId) === entry) {
      this.emitState(entry, status);
    }
  }

  private emitState(
    entry: PendingPlanDocument,
    status: PlanDocumentStateProjection['status'],
    content?: string,
  ): void {
    this.emit(this.projectState(entry, status, content));
  }

  private projectState(
    entry: PendingPlanDocument,
    status: PlanDocumentStateProjection['status'],
    content?: string,
  ): PlanDocumentStateProjection {
    return {
      type: 'plan.document.state',
      sessionId: entry.sessionId,
      turnId: entry.turnId,
      requestId: entry.requestId,
      status,
      ...(content === undefined ? {} : { content }),
    };
  }
}

function matches(
  entry: PendingPlanDocument,
  message: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly requestId: string;
  },
): boolean {
  return (
    entry.sessionId === message.sessionId &&
    entry.turnId === message.turnId &&
    entry.requestId === message.requestId
  );
}
