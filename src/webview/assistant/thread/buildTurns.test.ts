import { describe, expect, it } from "vitest";

import {
  buildTurns,
  questionTurnRows,
  turnIndexForMessage,
} from "./buildTurns";

describe("buildTurns", () => {
  it("keeps one user question and its reply in the same virtual row", () => {
    expect(
      buildTurns([
        { id: "u1", role: "user" },
        { id: "a1", role: "assistant" },
        { id: "a1b", role: "assistant" },
        { id: "u2", role: "user" },
        { id: "a2", role: "assistant" },
      ]),
    ).toEqual([
      { id: "u1", messageIds: ["u1", "a1", "a1b"] },
      { id: "u2", messageIds: ["u2", "a2"] },
    ]);
  });

  it("lets leading assistant history open a non-sticky turn", () => {
    expect(
      buildTurns([
        { id: "a0", role: "assistant" },
        { id: "u1", role: "user" },
        { id: "a1", role: "assistant" },
      ]),
    ).toEqual([
      { id: "a0", messageIds: ["a0"] },
      { id: "u1", messageIds: ["u1", "a1"] },
    ]);
  });
});

describe("turn navigation", () => {
  const turns = buildTurns([
    { id: "a0", role: "assistant" },
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant" },
    { id: "u2", role: "user" },
  ]);
  const roles = new Map([
    ["a0", "assistant" as const],
    ["u1", "user" as const],
    ["a1", "assistant" as const],
    ["u2", "user" as const],
  ]);

  it("indexes only user-led turns as questions", () => {
    expect(questionTurnRows(turns, roles)).toEqual({
      ids: ["u1", "u2"],
      indexes: [1, 2],
    });
  });

  it("maps any message in a reply back to its turn", () => {
    expect(turnIndexForMessage(turns, "a1")).toBe(1);
    expect(turnIndexForMessage(turns, "missing")).toBe(-1);
  });
});
