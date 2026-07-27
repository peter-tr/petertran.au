import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatherSupergraphContext } from "./supergraph-tool";

const fetchMock = vi.fn();
const messagesCreate = vi.fn();
const client = { messages: { create: messagesCreate } } as never;

// messagesCreate is called with a `messages` array that the loop keeps
// mutating (push) after each call - inspecting mock.calls[n][0].messages
// after the whole loop finishes would see its final, fully-mutated state,
// not what was actually sent on call n. Snapshot a deep copy at call time
// instead so assertions can check what was actually sent on each turn.
const sentMessages: unknown[][] = [];
function recordMessages(params: { messages: unknown[] }) {
  sentMessages.push(structuredClone(params.messages));
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function toolUseBlock(id: string, query: unknown) {
  return { type: "tool_use" as const, id, name: "query_portfolio_data", input: { query } };
}

describe("gatherSupergraphContext", () => {
  const originalEnv = process.env.SUPERGRAPH_URL;

  beforeEach(() => {
    fetchMock.mockReset();
    messagesCreate.mockReset();
    sentMessages.length = 0;
    vi.stubGlobal("fetch", fetchMock);
    process.env.SUPERGRAPH_URL = "https://api.petertran.au/graphql";
  });

  afterEach(() => {
    process.env.SUPERGRAPH_URL = originalEnv;
  });

  it("returns null without calling Claude when SUPERGRAPH_URL is unset", async () => {
    delete process.env.SUPERGRAPH_URL;

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a poster");

    expect(result).toBeNull();
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns the model's text when it decides no portfolio data is needed", async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [textBlock("No data needed for this prompt.")],
    });

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "an abstract poster");

    expect(result).toBe("No data needed for this prompt.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the model's final text is empty", async () => {
    messagesCreate.mockResolvedValueOnce({ stop_reason: "end_turn", content: [textBlock("")] });

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a poster");

    expect(result).toBeNull();
  });

  it("executes a valid tool call against the supergraph and returns the result as context", async () => {
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return { stop_reason: "tool_use", content: [toolUseBlock("t1", "{ person { name } }")] };
    });
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return { stop_reason: "end_turn", content: [textBlock("Use the name Peter Tran in the header.")] };
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { person: { name: "Peter Tran" } } }));

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a header with my name");

    expect(result).toBe("Use the name Peter Tran in the header.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.petertran.au/graphql",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ query: "{ person { name } }" }) })
    );

    // The 2nd Claude call's own messages include the tool_result from the
    // 1st call - i.e. what was actually sent for that turn, before any
    // later mutation of the shared messages array.
    const toolResultMessage = (
      sentMessages[1] as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!;
    expect(toolResultMessage.content[0].is_error).toBeUndefined();
    expect(toolResultMessage.content[0].content).toContain("Peter Tran");
  });

  it("returns an is_error tool_result and lets the model retry when the query is rejected", async () => {
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return {
        stop_reason: "tool_use",
        content: [toolUseBlock("t1", "mutation { sendMessage(input: {}) { ok } }")],
      };
    });
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return { stop_reason: "tool_use", content: [toolUseBlock("t2", "{ person { name } }")] };
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { person: { name: "Peter Tran" } } }));

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a header");

    expect(result).toBeNull(); // budget (2) exhausted right after the retry's tool_use turn

    const rejectedResult = (sentMessages[1] as { content: { is_error?: boolean; content: string }[] }[]).at(
      -1
    )!;
    expect(rejectedResult.content[0].is_error).toBe(true);
    expect(rejectedResult.content[0].content).toContain("Query rejected");
  });

  it("returns null once the tool-call budget is exhausted while still mid tool_use", async () => {
    messagesCreate.mockResolvedValue({
      stop_reason: "tool_use",
      content: [toolUseBlock("t1", "{ person { name } }")],
    });
    fetchMock.mockResolvedValue(jsonResponse({ data: { person: { name: "Peter Tran" } } }));

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a header");

    expect(result).toBeNull();
    expect(messagesCreate).toHaveBeenCalledTimes(2);
  });

  it("surfaces a fetch failure as an is_error tool_result instead of throwing", async () => {
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return { stop_reason: "tool_use", content: [toolUseBlock("t1", "{ person { name } }")] };
    });
    messagesCreate.mockImplementationOnce(async (params) => {
      recordMessages(params);

      return { stop_reason: "end_turn", content: [textBlock("done")] };
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: "boom" }] }, false));

    const result = await gatherSupergraphContext(client, "claude-sonnet-4-6", "a header");

    expect(result).toBe("done");

    const toolResult = (sentMessages[1] as { content: { is_error?: boolean; content: string }[] }[]).at(-1)!
      .content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain("Query failed");
  });
});
