import { describe, expect, it } from "vitest";
import {
  emptyBindingForm,
  emptyExchangeForm,
  toBindingInput,
  toExchangeDeclaration,
  validateBinding,
  validateExchange,
} from "./ExchangeDialog";

const t = (key: string) => key;

describe("the exchange declaration", () => {
  const form = () => ({ ...emptyExchangeForm("/"), name: "  ex.order  " });

  // Durable is the safe default and the zero value of the flag is "not
  // transient", so an exchange survives a restart unless someone said not to.
  it("trims the name and defaults to a durable topic exchange", () => {
    const declaration = toExchangeDeclaration(form());
    expect(declaration.name).toBe("ex.order");
    expect(declaration.type).toBe("topic");
    expect(declaration.transient).toBe(false);
  });

  it("omits the alternate exchange when none was chosen", () => {
    expect(JSON.parse(toExchangeDeclaration(form()).arguments)).toEqual({});
  });

  it("sends the alternate exchange as an argument", () => {
    const declaration = toExchangeDeclaration({ ...form(), alternateExchange: " ex.unrouted " });
    expect(JSON.parse(declaration.arguments)["alternate-exchange"]).toBe("ex.unrouted");
  });
});

describe("what the exchange form refuses", () => {
  it("needs a name and refuses the reserved prefix", () => {
    expect(validateExchange(emptyExchangeForm("/"), t)).toBe(
      "board.topics.rabbitmq.exchangeNameRequired",
    );
    expect(validateExchange({ ...emptyExchangeForm("/"), name: "amq.mine" }, t)).toBe(
      "board.topics.rabbitmq.nameReserved",
    );
  });

  // An exchange whose alternate is itself sends unroutable messages back into
  // itself. The broker accepts it and it does nothing.
  it("refuses an exchange as its own alternate", () => {
    expect(
      validateExchange(
        { ...emptyExchangeForm("/"), name: "ex.order", alternateExchange: "ex.order" },
        t,
      ),
    ).toBe("board.topics.rabbitmq.alternateIsSelf");
  });
});

describe("the binding", () => {
  const form = () => ({ ...emptyBindingForm(), destination: " order.q " });

  it("binds an exchange to a queue on a routing key", () => {
    const input = toBindingInput(
      { ...form(), routingKey: " order.created " },
      "/",
      "ex.order",
      "topic",
    );
    expect(input.source).toBe("ex.order");
    expect(input.destination).toBe("order.q");
    expect(input.destinationKind).toBe("queue");
    expect(input.routingKey).toBe("order.created");
  });

  /*
   * A headers exchange ignores the routing key entirely and matches on
   * arguments, so sending both would send one value that silently does
   * nothing.
   */
  it("sends header matches and no routing key for a headers exchange", () => {
    const input = toBindingInput(
      { ...form(), routingKey: "ignored", headerMatch: "any", headers: "kind=order" },
      "/",
      "ex.headers",
      "headers",
    );
    expect(input.routingKey).toBe("");
    expect(input.arguments["x-match"]).toBe("any");
    expect(input.arguments["kind"]).toBe("order");
  });

  // A header value can legitimately contain "=", so only the first one splits.
  it("keeps an equals sign inside a header value", () => {
    const input = toBindingInput(
      { ...form(), headers: "query=a=b" },
      "/",
      "ex.headers",
      "headers",
    );
    expect(input.arguments["query"]).toBe("a=b");
  });

  // Only a delete needs one, and it always comes from the listing rather than
  // being made up here.
  it("sends no properties key when creating", () => {
    expect(toBindingInput(form(), "/", "ex.order", "topic").propertiesKey).toBe("");
  });
});

describe("what the binding form refuses", () => {
  it("needs a target", () => {
    expect(validateBinding(emptyBindingForm(), "topic", t)).toBe(
      "board.topics.rabbitmq.bindTargetRequired",
    );
  });

  /*
   * A direct exchange bound with no routing key binds to the empty key, which
   * matches only messages published without one - almost never what was meant,
   * and it fails silently by simply never delivering.
   */
  it("refuses a direct binding with no routing key", () => {
    expect(validateBinding({ ...emptyBindingForm(), destination: "q" }, "direct", t)).toBe(
      "board.topics.rabbitmq.bindDirectNeedsKey",
    );
  });

  // A fanout ignores the key, so an empty one is correct there.
  it("accepts a fanout binding with no routing key", () => {
    expect(validateBinding({ ...emptyBindingForm(), destination: "q" }, "fanout", t)).toBeNull();
  });

  it("refuses a headers binding with nothing to match on", () => {
    expect(validateBinding({ ...emptyBindingForm(), destination: "q" }, "headers", t)).toBe(
      "board.topics.rabbitmq.bindHeadersNeedsHeaders",
    );
  });
});
