import { describe, expect, it } from "vitest";
import { emptyMoveForm, toMoveRequest, validateMove } from "./MoveDialog";

const t = (key: string) => key;

/**
 * A move is the one operation here that touches every message it sees, so what
 * the form turns into matters more than usual: a wrong target sends a batch
 * somewhere nobody is looking for it.
 */
describe("the move request", () => {
  /*
   * Sending to a queue means publishing to the default exchange with the
   * queue's name as the routing key. That is not a shortcut - it is how
   * RabbitMQ works - and spelling it out keeps the driver from guessing what
   * an empty exchange meant.
   */
  it("sends to a queue through the default exchange", () => {
    const request = toMoveRequest(
      { ...emptyMoveForm(), target: "queue", queue: " order.settle.q " },
      "/",
      "dlx.order.q",
    );
    expect(request.toExchange).toBe("");
    expect(request.toRoutingKey).toBe("order.settle.q");
    expect(request.from).toBe("dlx.order.q");
  });

  it("sends through a named exchange with its own routing key", () => {
    const request = toMoveRequest(
      { ...emptyMoveForm(), target: "exchange", exchange: "ex.retry", routingKey: "order.retry" },
      "/",
      "dlx.order.q",
    );
    expect(request.toExchange).toBe("ex.retry");
    expect(request.toRoutingKey).toBe("order.retry");
  });

  /*
   * An empty routing key on a named exchange means each message keeps its own,
   * which is what sends a batch of dead letters back through the topology they
   * originally took.
   */
  it("leaves the routing key empty so each message keeps its own", () => {
    const request = toMoveRequest(
      { ...emptyMoveForm(), target: "exchange", exchange: "ex.retry" },
      "/",
      "dlx.order.q",
    );
    expect(request.toRoutingKey).toBe("");
  });

  it("falls back to a sane batch size rather than moving everything", () => {
    for (const limit of ["", "0", "-5", "not a number"]) {
      expect(toMoveRequest({ ...emptyMoveForm(), queue: "q", limit }, "/", "src").limit).toBe(100);
    }
    expect(toMoveRequest({ ...emptyMoveForm(), queue: "q", limit: "25" }, "/", "src").limit).toBe(25);
  });
});

describe("what the move form refuses", () => {
  it("needs a target", () => {
    expect(validateMove(emptyMoveForm(), "src", t)).toBe(
      "board.topics.rabbitmq.moveTargetRequired",
    );
    expect(
      validateMove({ ...emptyMoveForm(), target: "exchange" }, "src", t),
    ).toBe("board.topics.rabbitmq.moveExchangeRequired");
  });

  // Draining a queue into itself moves every message to the back of it and
  // does nothing else, which is never what anyone meant.
  it("refuses a queue as its own target", () => {
    expect(validateMove({ ...emptyMoveForm(), queue: "src" }, "src", t)).toBe(
      "board.topics.rabbitmq.moveToSelf",
    );
  });

  it("accepts a different queue", () => {
    expect(validateMove({ ...emptyMoveForm(), queue: "dst" }, "src", t)).toBeNull();
  });
});
