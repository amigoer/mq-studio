import { describe, expect, it } from "vitest";
import { emptyPublishForm, parseHeaders, toPublishInput, validatePublish } from "@/mq/rabbitmq/publish";

const t = (key: string) => key;

describe("the publish form", () => {
  const form = () => ({ ...emptyPublishForm(), body: '{"a":1}' });

  /*
   * Both switches default on because both failures are silent otherwise: a
   * transient message vanishes on a restart even on a durable queue, and an
   * unroutable one is dropped by the broker and still confirmed.
   */
  it("defaults to persistent and mandatory", () => {
    const input = toPublishInput(form(), "/");
    expect(input.persistent).toBe(true);
    expect(input.mandatory).toBe(true);
  });

  // Addressing a queue is publishing to the default exchange with the queue's
  // name as the routing key. Spelling it out keeps the driver from guessing.
  it("sends to a queue through the default exchange", () => {
    const input = toPublishInput({ ...form(), target: "queue", queue: " order.q " }, "/");
    expect(input.exchange).toBe("");
    expect(input.routingKey).toBe("order.q");
  });

  it("sends to a named exchange with its own routing key", () => {
    const input = toPublishInput(
      { ...form(), target: "exchange", exchange: "ex.order", routingKey: "order.created" },
      "/",
    );
    expect(input.exchange).toBe("ex.order");
    expect(input.routingKey).toBe("order.created");
  });

  it("falls back to one copy rather than none", () => {
    for (const count of ["", "0", "-3", "nonsense"]) {
      expect(toPublishInput({ ...form(), count }, "/").count).toBe(1);
    }
    expect(toPublishInput({ ...form(), count: "50" }, "/").count).toBe(50);
  });
});

describe("the header field", () => {
  it("reads one name=value per line", () => {
    expect(parseHeaders("kind=order\nsource=gateway")).toEqual({
      kind: "order",
      source: "gateway",
    });
  });

  // A header value may itself contain an equals sign, so only the first splits.
  it("keeps an equals sign inside a value", () => {
    expect(parseHeaders("query=a=b")).toEqual({ query: "a=b" });
  });

  it("ignores blank lines and lines with no value", () => {
    expect(parseHeaders("\nkind=order\njust-a-name\n  ")).toEqual({ kind: "order" });
  });

  it("keeps an intentionally empty value", () => {
    expect(parseHeaders("marker=")).toEqual({ marker: "" });
  });
});

describe("what the publish form refuses", () => {
  it("needs a destination", () => {
    expect(validatePublish({ ...emptyPublishForm(), body: "x" }, t)).toBe(
      "board.producer.rabbitmq.queueRequired",
    );
    expect(
      validatePublish({ ...emptyPublishForm(), target: "exchange", body: "x" }, t),
    ).toBe("board.producer.rabbitmq.exchangeRequired");
  });

  it("needs a body", () => {
    expect(validatePublish({ ...emptyPublishForm(), queue: "q" }, t)).toBe(
      "board.producer.rabbitmq.bodyRequired",
    );
  });

  // The cap exists because each copy is its own confirm round trip.
  it("refuses a batch beyond what one send should do", () => {
    expect(validatePublish({ ...emptyPublishForm(), queue: "q", body: "x", count: "5000" }, t)).toBe(
      "board.producer.rabbitmq.countRange",
    );
  });

  it("accepts a queue, a body and one copy", () => {
    expect(
      validatePublish({ ...emptyPublishForm(), queue: "order.q", body: "x" }, t),
    ).toBeNull();
  });
});
