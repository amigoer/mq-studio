import { describe, expect, it } from "vitest";
import { emptyQueueForm, toDeclaration, validate } from "./QueueDialog";

const t = (key: string) => key;

/**
 * The declaration is where a form field becomes something the broker either
 * accepts or refuses, and RabbitMQ refuses precisely. An empty field is not a
 * zero, a number is not a string, and a queue's type cannot be changed later -
 * so getting this wrong is not a cosmetic bug.
 */
describe("the queue declaration", () => {
  const form = () => ({ ...emptyQueueForm("/"), name: "  order.settle.q  " });

  it("trims the name and defaults to a replicated, durable queue", () => {
    const declaration = toDeclaration(form());
    expect(declaration.name).toBe("order.settle.q");
    // Quorum, not classic: a classic queue is lost with the node holding it,
    // and choosing that has to be deliberate.
    expect(declaration.queueType).toBe("quorum");
    expect(declaration.durable).toBe(true);
  });

  /*
   * An empty field means "do not set this argument", not "set it to zero". A
   * max-length of zero is a queue that can hold nothing, which is the opposite
   * of leaving it unlimited.
   */
  it("omits an argument the form left blank rather than sending a zero", () => {
    const declaration = toDeclaration(form());
    expect(JSON.parse(declaration.arguments)).toEqual({});
  });

  it("sends the arguments that were filled in, as numbers", () => {
    const declaration = toDeclaration({
      ...form(),
      messageTtlMs: "30000",
      maxLength: "5000",
      overflow: "reject-publish",
      deadLetterExchange: " dlx.order ",
    });
    const args = JSON.parse(declaration.arguments);
    // Numbers rather than strings: the broker refuses a string where it wants
    // an integer, with an error naming a type nobody chose.
    expect(args["x-message-ttl"]).toBe(30000);
    expect(args["x-max-length"]).toBe(5000);
    expect(args["x-overflow"]).toBe("reject-publish");
    expect(args["x-dead-letter-exchange"]).toBe("dlx.order");
  });

  it("sends single-active-consumer only when it was asked for", () => {
    expect(JSON.parse(toDeclaration(form()).arguments)["x-single-active-consumer"]).toBeUndefined();
    const on = toDeclaration({ ...form(), singleActiveConsumer: true });
    expect(JSON.parse(on.arguments)["x-single-active-consumer"]).toBe(true);
  });

  /*
   * A stream is an append-only log on disk. A transient one is a contradiction
   * the broker rejects, so the form settles it rather than letting the request
   * fail.
   */
  it("forces a stream to be durable whatever the switch says", () => {
    const declaration = toDeclaration({ ...form(), queueType: "stream", durable: false });
    expect(declaration.durable).toBe(true);
  });

  it("leaves a classic queue transient when that was chosen", () => {
    const declaration = toDeclaration({ ...form(), queueType: "classic", durable: false });
    expect(declaration.durable).toBe(false);
  });
});

describe("what the queue form refuses", () => {
  const form = () => emptyQueueForm("/");

  it("needs a name", () => {
    expect(validate(form(), t)).toBe("board.topics.rabbitmq.nameRequired");
    expect(validate({ ...form(), name: "   " }, t)).toBe("board.topics.rabbitmq.nameRequired");
  });

  // The broker reserves this prefix for the exchanges and queues it makes
  // itself, and refuses a declare that uses it.
  it("refuses the prefix the broker reserves", () => {
    expect(validate({ ...form(), name: "amq.mine" }, t)).toBe(
      "board.topics.rabbitmq.nameReserved",
    );
  });

  /*
   * A dead-letter routing key with no exchange is silently ignored by the
   * broker: the declare succeeds and the queue does not do what was asked.
   * Catching it here is the difference between an error and a surprise.
   */
  it("refuses a dead-letter routing key with no exchange to send it to", () => {
    expect(validate({ ...form(), name: "q", deadLetterRoutingKey: "retry" }, t)).toBe(
      "board.topics.rabbitmq.dlxRoutingKeyNeedsExchange",
    );
  });

  it("accepts a queue with only a name", () => {
    expect(validate({ ...form(), name: "order.settle.q" }, t)).toBeNull();
  });
});
