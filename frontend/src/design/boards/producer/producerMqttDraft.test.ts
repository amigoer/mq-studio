import { describe, expect, it } from "vitest";
import {
  emptyMqttSendDraft,
  parseUserProperties,
  toMqttPublishInput,
  usesFiveProperties,
  validateMqttSendDraft,
  MAX_COUNT,
  type MqttSendDraft,
} from "./producerMqttDraft";

const draft = (over: Partial<MqttSendDraft> = {}): MqttSendDraft => ({
  ...emptyMqttSendDraft(),
  topic: "sensors/room-1/temperature",
  payload: "21.5",
  ...over,
});

describe("the MQTT send draft", () => {
  it("defaults to QoS 1 so a wrong topic is distinguishable from a working one", () => {
    // At QoS 0 the protocol acknowledges nothing, so both look identical.
    expect(emptyMqttSendDraft().qos).toBe("1");
  });

  it("accepts a plain publish", () => {
    expect(validateMqttSendDraft(draft(), true)).toBeNull();
  });

  it("refuses a topic with a wildcard in it", () => {
    // Wildcards belong in a filter. Some brokers answer a wildcard publish by
    // closing the connection rather than refusing it, which reads as an
    // unstable network.
    expect(validateMqttSendDraft(draft({ topic: "sensors/+/temperature" }), true)).toBe(
      "topicWildcard",
    );
    expect(validateMqttSendDraft(draft({ topic: "sensors/#" }), true)).toBe("topicWildcard");
  });

  it("refuses a topic that is not there", () => {
    expect(validateMqttSendDraft(draft({ topic: "  " }), true)).toBe("topicRequired");
  });

  it("refuses a count the driver would refuse anyway", () => {
    expect(validateMqttSendDraft(draft({ count: "0" }), true)).toBe("countInvalid");
    expect(validateMqttSendDraft(draft({ count: String(MAX_COUNT + 1) }), true)).toBe(
      "countInvalid",
    );
    expect(validateMqttSendDraft(draft({ count: String(MAX_COUNT) }), true)).toBeNull();
  });

  /*
   * The 5.0 properties are refused on a 3.1.1 connection rather than dropped.
   *
   * A correlation id that vanished in transit is worse than one that was never
   * accepted: the first is found by whoever debugs the consumer, and by then
   * nothing points back at this form.
   */
  it("refuses the 5.0 properties on a 3.1.1 connection", () => {
    for (const over of [
      { contentType: "application/json" },
      { responseTopic: "rpc/reply" },
      { correlationData: "req-1" },
      { messageExpiry: "60" },
      { userProperties: "tenant=acme" },
    ]) {
      expect(validateMqttSendDraft(draft(over), false)).toBe("needsFive");
      expect(validateMqttSendDraft(draft(over), true)).toBeNull();
    }
  });

  it("knows when a draft uses nothing 3.1.1 lacks", () => {
    expect(usesFiveProperties(draft())).toBe(false);
    expect(usesFiveProperties(draft({ contentType: "text/plain" }))).toBe(true);
  });

  it("refuses a user property that is not name=value", () => {
    expect(validateMqttSendDraft(draft({ userProperties: "tenant" }), true)).toBe("propertyLine");
    expect(validateMqttSendDraft(draft({ userProperties: "=acme" }), true)).toBe("propertyLine");
  });

  it("parses user properties, keeping an equals sign inside a value", () => {
    expect(parseUserProperties("tenant=acme\n\nsignature=a=b")).toEqual({
      tenant: "acme",
      signature: "a=b",
    });
  });

  it("sends a 3.1.1 publish with none of the 5.0 fields set", () => {
    // Cleared here rather than left for the driver to refuse, so a hidden
    // field holding an old value cannot fail a send the user cannot see.
    const input = toMqttPublishInput(
      draft({ contentType: "application/json", userProperties: "tenant=acme" }),
      false,
    );

    expect(input.contentType).toBe("");
    expect(input.messageExpiry).toBe(0);
    expect(input.userProperties).toEqual({});
    expect(input.topic).toBe("sensors/room-1/temperature");
    expect(input.qos).toBe(1);
  });

  it("sends a 5.0 publish with them", () => {
    const input = toMqttPublishInput(
      draft({
        qos: "2",
        retain: true,
        count: "3",
        contentType: "application/json",
        responseTopic: "rpc/reply",
        correlationData: "req-1",
        messageExpiry: "60",
        userProperties: "tenant=acme",
      }),
      true,
    );

    expect(input).toMatchObject({
      qos: 2,
      retain: true,
      count: 3,
      contentType: "application/json",
      responseTopic: "rpc/reply",
      correlationData: "req-1",
      messageExpiry: 60,
      userProperties: { tenant: "acme" },
    });
  });
});
