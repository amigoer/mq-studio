import { describe, expect, it } from "vitest";
import { MAX_COUNT, emptyPublishForm, parseProperties, toInput, validate } from "./publish";

const t = (key: string) => key;

const form = (over: Partial<ReturnType<typeof emptyPublishForm>> = {}) => ({
  ...emptyPublishForm("persistent://public/default/orders"),
  body: "hello",
  ...over,
});

/*
 * Pulsar has no tag, so properties are where a marker goes - and they are what
 * the messages page filters on. A line the form silently dropped would send a
 * message the browse cannot find.
 */
describe("the property lines", () => {
  it("reads name=value per line", () => {
    expect(parseProperties("stage=paid\nregion=eu")).toEqual({
      properties: { stage: "paid", region: "eu" },
    });
  });

  it("ignores blank lines", () => {
    expect(parseProperties("\n  \nstage=paid\n")).toEqual({ properties: { stage: "paid" } });
  });

  it("keeps a value containing an equals sign", () => {
    expect(parseProperties("query=a=b")).toEqual({ properties: { query: "a=b" } });
  });

  // "stage paid" is somebody meaning to set a property. Dropping it silently
  // would send a message without the marker they typed.
  it("refuses a line with no equals sign", () => {
    expect(parseProperties("stage paid")).toEqual({ error: "stage paid" });
  });

  it("refuses a value with no name", () => {
    expect(parseProperties("=paid")).toEqual({ error: "=paid" });
  });
});

/*
 * The delay is in seconds, and nothing else pins that.
 *
 * ports.go fixes no unit, so the label, this function and the driver are the
 * only three places the reading is written down - and a mismatch schedules a
 * message for a wildly different time without failing.
 */
describe("what the form sends", () => {
  it("converts the delay from seconds to milliseconds", () => {
    expect(toInput(form({ delaySeconds: "30" })).deliverAfterMs).toBe(30000);
  });

  it("treats a blank delay as no delay", () => {
    expect(toInput(form()).deliverAfterMs).toBe(0);
  });

  // Stamping now would be a claim about when the event happened that the
  // operator did not make.
  it("leaves the event time unset", () => {
    expect(toInput(form()).eventTimeMs).toBe(0);
  });

  it("trims the addresses and keys but not the body", () => {
    const input = toInput(form({ key: "  k  ", orderingKey: "  o  ", body: "  spaced  " }));
    expect(input.key).toBe("k");
    expect(input.orderingKey).toBe("o");
    expect(input.body).toBe("  spaced  ");
  });
});

/*
 * The count is checked against the driver's own cap here so the message names
 * the field, rather than arriving as a refusal from Go after the send.
 */
describe("what the form refuses", () => {
  it("needs a topic and a body", () => {
    expect(validate(form({ topic: "" }), t)).toBe("board.producer.pulsar.topicRequired");
    expect(validate(form({ body: "" }), t)).toBe("board.producer.pulsar.bodyRequired");
  });

  it("refuses a delay that is not whole seconds", () => {
    expect(validate(form({ delaySeconds: "30s" }), t)).toBe("board.producer.pulsar.delayInvalid");
    expect(validate(form({ delaySeconds: "-1" }), t)).toBe("board.producer.pulsar.delayInvalid");
    expect(validate(form({ delaySeconds: "1.5" }), t)).toBe("board.producer.pulsar.delayInvalid");
  });

  it("needs at least one message", () => {
    expect(validate(form({ count: "0" }), t)).toBe("board.producer.pulsar.countInvalid");
    expect(validate(form({ count: "" }), t)).toBe("board.producer.pulsar.countInvalid");
  });

  // A slipped digit turns "send 10" into a hand-typed load test against a
  // production topic, and every one of them is a synchronous round trip.
  it("refuses a repeat larger than the driver's cap", () => {
    expect(validate(form({ count: String(MAX_COUNT) }), t)).toBeNull();
    expect(validate(form({ count: String(MAX_COUNT + 1) }), t)).toBe(
      "board.producer.pulsar.countTooLarge",
    );
  });

  it("refuses a property line it could not read", () => {
    expect(validate(form({ properties: "stage paid" }), t)).toBe(
      "board.producer.pulsar.propertyLineInvalid",
    );
  });

  it("accepts an ordinary message", () => {
    expect(validate(form({ properties: "stage=paid", delaySeconds: "60", count: "5" }), t)).toBeNull();
  });
});
