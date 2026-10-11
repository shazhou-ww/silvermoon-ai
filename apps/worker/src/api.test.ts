import { describe, expect, it } from "vitest";
import { pendingInputRequests } from "./api";

describe("pendingInputRequests", () => {
  it("returns the latest unresolved structured request per session", () => {
    const requests = pendingInputRequests([{
      session_id: "session-1",
      role: "assistant",
      content: "Choose a target.",
      data_json: JSON.stringify({
        inputRequestId: "input-1",
        inputRequestResolved: false,
        inputRequest: {
          id: "input-1",
          message: "Choose a target.",
          url: null,
          questions: [{
            id: "target",
            kind: "single-select",
            message: "Where should I deploy?",
            options: [{ id: "staging", label: "Staging" }],
          }],
        },
      }),
    }]);

    expect(requests.get("session-1")).toMatchObject({
      id: "input-1",
      questions: [{
        kind: "single-select",
        options: [{ label: "Staging" }],
      }],
    });
  });

  it("ignores requests whose latest event is resolved", () => {
    const requests = pendingInputRequests([{
      session_id: "session-1",
      role: "user",
      content: "Staging",
      data_json: JSON.stringify({
        inputRequestId: "input-1",
        inputRequestResolved: true,
      }),
    }, {
      session_id: "session-1",
      role: "assistant",
      content: "Choose a target.",
      data_json: JSON.stringify({
        inputRequestId: "input-1",
        inputRequestResolved: false,
      }),
    }]);

    expect(requests.has("session-1")).toBe(false);
  });

  it("uses legacy prompt text without inventing missing metadata", () => {
    const requests = pendingInputRequests([{
      session_id: "session-1",
      role: "assistant",
      content: "What should I do next?",
      data_json: JSON.stringify({ inputRequestId: "legacy-input" }),
    }]);

    expect(requests.get("session-1")).toEqual({
      id: "legacy-input",
      message: "What should I do next?",
      url: null,
      questions: [],
    });
  });
});
