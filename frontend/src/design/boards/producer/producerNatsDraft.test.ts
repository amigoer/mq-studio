import { describe, expect, it } from "vitest";
import {
  emptyProducerDraft,
  parseHeaders,
  producerDraftError,
  toPublishInput,
} from "./producerNatsDraft";

function draft(over: Partial<ReturnType<typeof emptyProducerDraft>> = {}) {
  return { ...emptyProducerDraft(), subject: "orders.created", ...over };
}

describe("what the NATS send console will send", () => {
  it("sends a core message by default", () => {
    const input = toPublishInput(draft({ payload: "x" }));
    expect(input.persist).toBe(false);
    expect(input.count).toBe(1);
    expect(input.replyTimeoutMs).toBe(0);
  });

  it("reads headers written one per line", () => {
    expect(parseHeaders("Region: eu\nTrace: abc")).toEqual({ Region: "eu", Trace: "abc" });
  });

  it("skips blank lines rather than refusing them", () => {
    expect(parseHeaders("Region: eu\n\n  \nTrace: abc")).toEqual({
      Region: "eu",
      Trace: "abc",
    });
  });

  it("refuses a header line with no name", () => {
    expect(parseHeaders("just a line")).toBeNull();
    expect(parseHeaders(": nothing")).toBeNull();
  });

  /*
   * A stream to expect and a deduplication id are both checked by the server
   * while it stores the message, so on a core send there is nothing to check
   * them against. Sending them anyway would show settings back as if they were
   * in force.
   */
  it("drops the stored-send settings from a core send", () => {
    const input = toPublishInput(
      draft({ persist: false, expectStream: "ORDERS", deduplicationId: "order-42" }),
    );
    expect(input.expectStream).toBe("");
    expect(input.deduplicationId).toBe("");
  });

  it("keeps them on a stored send", () => {
    const input = toPublishInput(
      draft({ persist: true, expectStream: "ORDERS", deduplicationId: "order-42" }),
    );
    expect(input.expectStream).toBe("ORDERS");
    expect(input.deduplicationId).toBe("order-42");
  });
});

describe("what the console refuses before sending", () => {
  it("accepts an ordinary message", () => {
    expect(producerDraftError(draft())).toBeNull();
  });

  it("needs a subject", () => {
    expect(producerDraftError(draft({ subject: "  " }))).toBe("subjectRequired");
  });

  /*
   * The one that matters. A wildcard subscribes; it does not publish. The
   * server accepts it, matches nothing, and reports success - so the message
   * reaches nobody, is stored by no stream, and the console says it worked.
   */
  it("refuses a pattern in place of an address", () => {
    for (const subject of ["orders.*", "orders.>", "*", ">"]) {
      expect(producerDraftError(draft({ subject })), subject).toBe("subjectIsPattern");
    }
  });

  it("refuses a subject with a space or an empty token", () => {
    expect(producerDraftError(draft({ subject: "orders created" }))).toBe("subjectInvalid");
    expect(producerDraftError(draft({ subject: "orders..created" }))).toBe("subjectInvalid");
  });

  it("keeps the repeat count inside what the driver allows", () => {
    expect(producerDraftError(draft({ count: "0" }))).toBe("countInvalid");
    expect(producerDraftError(draft({ count: "1001" }))).toBe("countInvalid");
    expect(producerDraftError(draft({ count: "lots" }))).toBe("countInvalid");
  });

  it("refuses a request that would be sent more than once", () => {
    expect(producerDraftError(draft({ replyTimeoutMs: "500", count: "5" }))).toBe(
      "requestCannotRepeat",
    );
    expect(producerDraftError(draft({ replyTimeoutMs: "500" }))).toBeNull();
  });

  it("refuses a reply timeout that is not a positive number", () => {
    expect(producerDraftError(draft({ replyTimeoutMs: "0" }))).toBe("waitInvalid");
    expect(producerDraftError(draft({ replyTimeoutMs: "soon" }))).toBe("waitInvalid");
  });

  it("refuses stored-send settings on a core send", () => {
    expect(producerDraftError(draft({ expectStream: "ORDERS" }))).toBe("expectNeedsPersist");
    expect(producerDraftError(draft({ deduplicationId: "x" }))).toBe("dedupNeedsPersist");
  });

  it("refuses a headers box that is not headers", () => {
    expect(producerDraftError(draft({ headers: "Region eu" }))).toBe("headersInvalid");
  });
});
