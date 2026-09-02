import { describe, expect, it } from "vitest";
import type { Subscription } from "@bindings/model/models";
import {
  consumerDraftError,
  emptyConsumerDraft,
  toConsumerDraft,
  toConsumerInput,
} from "./consumerDraftNats";

function draft(over: Partial<ReturnType<typeof emptyConsumerDraft>> = {}) {
  return { ...emptyConsumerDraft("ORDERS"), name: "worker", ...over };
}

describe("what the consumer dialog will submit", () => {
  it("defaults to a durable pull consumer reading the whole stream", () => {
    const input = toConsumerInput(draft());
    expect(input.durable).toBe(true);
    expect(input.deliverSubject).toBe("");
    expect(input.filterSubject).toBe("");
    expect(input.deliverPolicy).toBe("all");
  });

  it("normalises a filter list however it was separated", () => {
    const input = toConsumerInput(draft({ filterSubject: "a.b,  c.d ; e.f" }));
    expect(input.filterSubject).toBe("a.b,c.d,e.f");
  });

  /*
   * A queue group only means anything alongside a delivery subject. Sending
   * one without would store a setting the server silently ignores, and the
   * form would then show it back as if it were in force.
   */
  it("drops a queue group when the consumer is not a push one", () => {
    const input = toConsumerInput(draft({ deliverSubject: "", deliverGroup: "workers" }));
    expect(input.deliverGroup).toBe("");
  });

  it("keeps the queue group on a push consumer", () => {
    const input = toConsumerInput(
      draft({ deliverSubject: "deliver.orders", deliverGroup: "workers" }),
    );
    expect(input.deliverSubject).toBe("deliver.orders");
    expect(input.deliverGroup).toBe("workers");
  });
});

describe("what the dialog refuses before asking the server", () => {
  it("accepts an ordinary pull consumer", () => {
    expect(consumerDraftError(draft())).toBeNull();
  });

  it("needs a stream and a name", () => {
    expect(consumerDraftError(draft({ stream: "  " }))).toBe("streamRequired");
    expect(consumerDraftError(draft({ name: "" }))).toBe("nameRequired");
  });

  it("refuses a subject pasted in as a consumer name", () => {
    for (const name of ["orders.worker", "worker*", "worker>", "my worker", "a/b"]) {
      expect(consumerDraftError(draft({ name })), name).toBe("nameInvalid");
    }
  });

  it("refuses a filter whose wildcard would match nothing", () => {
    expect(consumerDraftError(draft({ filterSubject: "orders.>.created" }))).toBe("filterInvalid");
    expect(consumerDraftError(draft({ filterSubject: "orders.>" }))).toBeNull();
  });

  /*
   * A delivery subject is where the server sends, not a pattern it matches, so
   * a wildcard in it is an address nothing can be published to. The server
   * accepts it and the consumer then delivers into a void.
   */
  it("refuses a wildcard in the delivery subject", () => {
    expect(consumerDraftError(draft({ deliverSubject: "deliver.>" }))).toBe("deliverInvalid");
    expect(consumerDraftError(draft({ deliverSubject: "deliver.orders" }))).toBeNull();
  });

  it("refuses a queue group with nothing to deliver to", () => {
    expect(consumerDraftError(draft({ deliverGroup: "workers" }))).toBe("groupNeedsDeliver");
  });
});

describe("reading an existing consumer back into the form", () => {
  const consumer = {
    ref: { namespace: "ORDERS", name: "worker" },
    status: "online",
    members: -1,
    destinations: 1,
    backlog: 80,
    rateOut: -1,
    lastUpdated: "",
    attributes: {
      stream: "ORDERS",
      durable: "worker",
      deliverPolicy: "all",
      ackPolicy: "explicit",
      ackWait: "30s",
      maxDeliver: "-1",
      maxAckPending: "1000",
      filterSubject: "orders.shipped, orders.delivered",
      replayPolicy: "instant",
      consumerKind: "pull",
    },
  } as unknown as Subscription;

  it("brings back what the consumer is configured with", () => {
    const back = toConsumerDraft(consumer);
    expect(back.stream).toBe("ORDERS");
    expect(back.name).toBe("worker");
    expect(back.durable).toBe(true);
    expect(back.ackWait).toBe("30s");
    expect(back.filterSubject).toBe("orders.shipped, orders.delivered");
  });

  /* -1 is unlimited, and a blank field is how that has to read. */
  it("brings an unlimited attempt count back as a blank field", () => {
    expect(toConsumerDraft(consumer).maxDeliver).toBe("");
  });

  /* An ephemeral consumer reports no durable name, and the switch has to
     reflect that rather than defaulting back to durable. */
  it("brings an ephemeral consumer back as ephemeral", () => {
    const ephemeral = {
      ...consumer,
      attributes: { ...consumer.attributes, durable: "" },
    } as unknown as Subscription;
    expect(toConsumerDraft(ephemeral).durable).toBe(false);
  });

  it("round-trips into something the dialog would accept", () => {
    expect(consumerDraftError(toConsumerDraft(consumer))).toBeNull();
  });
});
