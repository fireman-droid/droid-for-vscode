// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChangesTranscriptItem } from "../../shared/bridgeMessages";
import { GitCommitFlowContext } from "./GitCommitPanel";
import { ReviewDock } from "./ReviewDock";
import { initialGitCommitFlowState } from "./store";

afterEach(cleanup);

const files = [
  { path: "prototypes/dashboard.HTML", additions: 12, deletions: 0 },
  { path: "demo/legacy.htm", additions: null, deletions: null },
  { path: "src/app.tsx", additions: 3, deletions: 1 },
] as const;

function changes(
  turnId = "turn-a",
  writing?: boolean,
  nextFiles: ChangesTranscriptItem["files"] = files,
): ChangesTranscriptItem {
  return {
    id: `changes:${turnId}`,
    kind: "changes",
    turnId,
    files: nextFiles,
    ...(writing === undefined ? {} : { writing }),
  };
}

describe("ReviewDock", () => {
  it("stays absent without files and exposes no rewind controls", () => {
    const onOpenFileDiff = vi.fn();
    const onPreviewFile = vi.fn();
    const { rerender } = render(
      <ReviewDock
        changes={changes("turn-a", false, [])}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "Review latest changes" }),
    ).toBeNull();

    rerender(
      <ReviewDock
        changes={changes()}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    const dock = screen.getByRole("region", {
      name: "Review latest changes",
    });
    expect(
      within(dock).queryByRole("button", { name: /undo|rewind/i }),
    ).toBeNull();
  });

  it("is a collapsed button-controlled row and expands its file list", () => {
    render(
      <ReviewDock
        changes={changes()}
        onOpenFileDiff={vi.fn()}
        onPreviewFile={vi.fn()}
      />,
    );
    const toggle = screen.getByRole<HTMLButtonElement>("button", {
      name: "3 files changed",
    });
    const controlledId = toggle.getAttribute("aria-controls");
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(controlledId).toBeTruthy();
    expect(document.getElementById(controlledId!)).toBeNull();
    expect(screen.queryByText("src/app.tsx")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(controlledId!)).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    screen.getByText("src/app.tsx");
  });

  it("passes the real turn and path to Diff and previews only HTML files", () => {
    const onOpenFileDiff = vi.fn();
    const onPreviewFile = vi.fn();
    render(
      <ReviewDock
        changes={changes("turn-real")}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "3 files changed" }),
    );

    fireEvent.click(screen.getByTitle("Open changes for src/app.tsx"));
    expect(onOpenFileDiff).toHaveBeenCalledWith(
      "src/app.tsx",
      "turn-real",
    );
    const previews = screen.getAllByRole("button", { name: "Canvas" });
    expect(previews).toHaveLength(2);
    expect(
      screen.queryByTitle("Open src/app.tsx in Canvas"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTitle(
        "Open prototypes/dashboard.HTML in Canvas",
      ),
    );
    expect(onPreviewFile).toHaveBeenCalledWith(
      "prototypes/dashboard.HTML",
    );
  });

  it("reviews every file once in the supplied stable order", () => {
    const onOpenFileDiff = vi.fn();
    render(
      <ReviewDock
        changes={changes("turn-ordered")}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onOpenFileDiff.mock.calls).toEqual([
      ["prototypes/dashboard.HTML", "turn-ordered"],
      ["demo/legacy.htm", "turn-ordered"],
      ["src/app.tsx", "turn-ordered"],
    ]);
  });

  it("updates a writing frame without resetting expansion, then resets for a new turn", () => {
    const onOpenFileDiff = vi.fn();
    const onPreviewFile = vi.fn();
    const view = render(
      <ReviewDock
        key="session-a:turn-a"
        changes={changes("turn-a", true, files.slice(0, 1))}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^1 file changed/ }),
    );
    expect(screen.getByRole("status").textContent).toBe("writing");

    view.rerender(
      <ReviewDock
        key="session-a:turn-a"
        changes={changes("turn-a", false, files.slice(0, 2))}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    const sameTurnToggle = screen.getByRole("button", {
      name: "2 files changed",
    });
    expect(sameTurnToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
    screen.getByText("demo/legacy.htm");

    view.rerender(
      <ReviewDock
        key="session-a:turn-b"
        changes={changes("turn-b", false, files.slice(0, 1))}
        onOpenFileDiff={onOpenFileDiff}
        onPreviewFile={onPreviewFile}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "1 file changed" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText("prototypes/dashboard.HTML")).toBeNull();
  });

  it("reuses the existing commit entry only for the latest Changes turn", () => {
    const value = {
      state: {
        ...initialGitCommitFlowState,
        availability: "available" as const,
        statusTurnId: "turn-a",
        files: [
          {
            path: "prototypes/dashboard.HTML",
            status: "modified" as const,
            staged: false,
            inTurn: true,
          },
        ],
      },
      latestChangesTurnId: "turn-a",
      promptText: "Update the prototype",
      onRequestStatus: vi.fn(),
      onCommit: vi.fn(),
    };
    const view = render(
      <GitCommitFlowContext.Provider value={value}>
        <ReviewDock
          changes={changes("turn-a")}
          onOpenFileDiff={vi.fn()}
          onPreviewFile={vi.fn()}
        />
      </GitCommitFlowContext.Provider>,
    );
    screen.getByRole("button", { name: "Commit…" });

    view.rerender(
      <GitCommitFlowContext.Provider
        value={{ ...value, latestChangesTurnId: "turn-newer" }}
      >
        <ReviewDock
          changes={changes("turn-a")}
          onOpenFileDiff={vi.fn()}
          onPreviewFile={vi.fn()}
        />
      </GitCommitFlowContext.Provider>,
    );
    expect(
      screen.queryByRole("button", { name: "Commit…" }),
    ).toBeNull();
  });

  it("cancels its deferred frame when it unmounts", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const frame = nextFrame;
        nextFrame += 1;
        callbacks.set(frame, callback);
        return frame;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((frame) => {
        callbacks.delete(frame);
      });
    try {
      const view = render(
        <ReviewDock
          changes={changes()}
          onOpenFileDiff={vi.fn()}
          onPreviewFile={vi.fn()}
          deferMount
        />,
      );
      expect(
        screen.queryByRole("region", { name: "Review latest changes" }),
      ).toBeNull();
      expect(callbacks.size).toBe(1);
      const frame = [...callbacks.keys()][0]!;

      view.unmount();
      expect(cancelFrame).toHaveBeenCalledWith(frame);
      expect(callbacks.size).toBe(0);
    } finally {
      cancelFrame.mockRestore();
      requestFrame.mockRestore();
    }
  });

  it("drops a deferred old turn when the keyed dock switches sessions", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const frame = nextFrame;
        nextFrame += 1;
        callbacks.set(frame, callback);
        return frame;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((frame) => {
        callbacks.delete(frame);
      });
    try {
      const view = render(
        <ReviewDock
          key="session-a:turn-a"
          changes={changes("turn-a", false, [
            { path: "old.html", additions: 1, deletions: 0 },
          ])}
          onOpenFileDiff={vi.fn()}
          onPreviewFile={vi.fn()}
          deferMount
        />,
      );
      const oldFrame = [...callbacks.keys()][0]!;

      view.rerender(
        <ReviewDock
          key="session-b:turn-b"
          changes={changes("turn-b", false, [
            { path: "new.html", additions: 2, deletions: 0 },
          ])}
          onOpenFileDiff={vi.fn()}
          onPreviewFile={vi.fn()}
          deferMount
        />,
      );
      expect(cancelFrame).toHaveBeenCalledWith(oldFrame);
      expect(callbacks.has(oldFrame)).toBe(false);
      expect(callbacks.size).toBe(1);

      const currentFrame = [...callbacks.values()][0]!;
      act(() => currentFrame(performance.now()));
      screen.getByRole("region", { name: "Review latest changes" });
      expect(screen.queryByTitle("Open changes for old.html")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "1 file changed" }),
      );
      screen.getByTitle("Open changes for new.html");
    } finally {
      cancelFrame.mockRestore();
      requestFrame.mockRestore();
    }
  });
});
