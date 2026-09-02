import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import {
  emptyStreamDraft,
  splitSubjects,
  streamDraftError,
  toStreamDraft,
  toStreamInput,
} from "./streamDraftNats";

function draft(over: Partial<ReturnType<typeof emptyStreamDraft>> = {}) {
  return { ...emptyStreamDraft(), name: "ORDERS", subjects: "orders.>", ...over };
}

describe("what the stream dialog will submit", () => {
  it("takes a subject list however the user separated it", () => {
    expect(splitSubjects("a.b, c.d;e.f\n g.h")).toEqual(["a.b", "c.d", "e.f", "g.h"]);
    expect(splitSubjects("   ")).toEqual([]);
  });

  it("trims the name and normalises the subject list", () => {
    const input = toStreamInput(draft({ name: "  ORDERS  ", subjects: "a.b,  c.d " }));
    expect(input.name).toBe("ORDERS");
    expect(input.subjects).toBe("a.b,c.d");
  });

  /*
   * The limits stay strings all the way to the driver so that "left blank" and
   * "set to zero" stay different. -1 is the server's no-limit spelling and 0
   * means a stream that can hold nothing; collapsing them here would pick one
   * of those on the user's behalf.
   */
  it("sends a blank limit as blank rather than as a number", () => {
    const input = toStreamInput(draft());
    expect(input.maxMsgs).toBe("");
    expect(input.maxBytes).toBe("");
    expect(input.maxAge).toBe("");
  });

  it("sends a limit the user typed", () => {
    const input = toStreamInput(draft({ maxMsgs: " 1000 ", maxAge: " 24h " }));
    expect(input.maxMsgs).toBe("1000");
    expect(input.maxAge).toBe("24h");
  });
});

/*
 * The two checks here are the two the server's own errors do not explain.
 * Everything else is left to the server on purpose - a rule copied into the
 * client is a rule that goes stale a release later.
 */
describe("what the dialog refuses before asking the server", () => {
  it("accepts an ordinary stream", () => {
    expect(streamDraftError(draft())).toBeNull();
  });

  it("needs a name and at least one subject", () => {
    expect(streamDraftError(draft({ name: "  " }))).toBe("nameRequired");
    expect(streamDraftError(draft({ subjects: "" }))).toBe("subjectsRequired");
  });

  /*
   * A stream name is not a subject, and pasting one in is the commonest
   * mistake. The server answers "invalid stream name", which leaves somebody
   * staring at something that looks perfectly fine.
   */
  it("refuses a subject pasted in as a name", () => {
    for (const name of ["orders.created", "orders.*", "orders>", "my stream", "a/b"]) {
      expect(streamDraftError(draft({ name })), name).toBe("nameInvalid");
    }
  });

  /*
   * A > matches the rest of a subject, so anywhere but the end it silently
   * matches nothing - and the stream sits there collecting no messages with
   * nothing on screen to say why.
   */
  it("refuses a wildcard where it would match nothing", () => {
    for (const subjects of ["orders.>.created", "orders.new*", "orders..created"]) {
      expect(streamDraftError(draft({ subjects })), subjects).toBe("subjectInvalid");
    }
  });

  it("accepts the wildcards that do work", () => {
    for (const subjects of ["orders.>", "orders.*.created", "orders.created"]) {
      expect(streamDraftError(draft({ subjects })), subjects).toBeNull();
    }
  });

  it("keeps the replica count inside what a raft group can be", () => {
    expect(streamDraftError(draft({ replicas: 0 }))).toBe("replicasInvalid");
    expect(streamDraftError(draft({ replicas: 6 }))).toBe("replicasInvalid");
    expect(streamDraftError(draft({ replicas: 3 }))).toBeNull();
  });
});

describe("reading an existing stream back into the form", () => {
  const stream = {
    ref: { namespace: "", name: "ORDERS" },
    depth: 0,
    subscribers: 0,
    partitions: -1,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes: {
      subjects: "orders.created, orders.shipped",
      retention: "workqueue",
      storage: "memory",
      discard: "new",
      replicas: "3",
      maxMsgs: "1000",
      maxAge: "24h0m0s",
      denyDelete: "true",
    },
  } as unknown as Destination;

  it("brings back what the stream is configured with", () => {
    const back = toStreamDraft(stream);
    expect(back.name).toBe("ORDERS");
    expect(back.subjects).toBe("orders.created, orders.shipped");
    expect(back.retention).toBe("workqueue");
    expect(back.storage).toBe("memory");
    expect(back.replicas).toBe(3);
    expect(back.maxMsgs).toBe("1000");
    expect(back.maxAge).toBe("24h0m0s");
    expect(back.denyDelete).toBe(true);
  });

  /*
   * The server's no-limit spelling has to come back as an empty field, not as
   * a "-1" the user would then have to know the meaning of - and certainly not
   * as a number they might edit into something real by accident.
   */
  it("brings an absent limit back as a blank field", () => {
    const unlimited = {
      ...stream,
      attributes: { subjects: "orders.>", maxMsgs: "-1", maxBytes: "-1", maxAge: "0s" },
    } as unknown as Destination;
    const back = toStreamDraft(unlimited);
    expect(back.maxMsgs).toBe("");
    expect(back.maxBytes).toBe("");
    expect(back.maxAge).toBe("");
  });

  /* A stream read back and submitted unchanged must be submittable. */
  it("round-trips into something the dialog would accept", () => {
    expect(streamDraftError(toStreamDraft(stream))).toBeNull();
  });
});
