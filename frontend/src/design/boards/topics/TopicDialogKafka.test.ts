import { describe, expect, it } from "vitest";
import {
  emptyKafkaTopicDraft,
  parseConfigLines,
  toKafkaTopicInput,
  validateKafkaTopicDraft,
} from "./TopicDialogKafka";

const draft = (over: Partial<ReturnType<typeof emptyKafkaTopicDraft>> = {}) => ({
  ...emptyKafkaTopicDraft(),
  name: "orders.created",
  ...over,
});

/**
 * Kafka refuses a topic name outside [a-zA-Z0-9._-], and a form that lets one
 * through turns a preventable mistake into a broker error the user has to
 * decode.
 */
describe("the Kafka topic name rule", () => {
  it("accepts what Kafka accepts", () => {
    for (const name of ["orders", "orders.created", "orders_v2", "orders-v2", "a"]) {
      expect(validateKafkaTopicDraft(draft({ name }))).toBeNull();
    }
  });

  it("refuses what Kafka refuses", () => {
    for (const name of ["", "  ", "orders/created", "orders created", "订单", ".", ".."]) {
      expect(validateKafkaTopicDraft(draft({ name }))).not.toBeNull();
    }
  });

  it("refuses a name past the broker's limit", () => {
    expect(validateKafkaTopicDraft(draft({ name: "a".repeat(249) }))).toBeNull();
    expect(validateKafkaTopicDraft(draft({ name: "a".repeat(250) }))).toBe("nameTooLong");
  });
});

/**
 * Blank means "let the cluster decide", which is why every numeric field is a
 * string. Zero partitions and "you pick" are different requests and a number
 * input would collapse them into one.
 */
describe("the Kafka topic numeric fields", () => {
  it("treats blank as the cluster default rather than as zero", () => {
    const empty = draft({ partitions: "", replicationFactor: "", minInsyncReplicas: "" });
    expect(validateKafkaTopicDraft(empty)).toBeNull();

    const input = toKafkaTopicInput(empty);
    expect(input.partitions).toBe(0);
    expect(input.replicationFactor).toBe(0);
    expect(input.configs["min.insync.replicas"]).toBeUndefined();
  });

  it("refuses a count below one", () => {
    expect(validateKafkaTopicDraft(draft({ partitions: "0" }))).toBe("notANumber");
    expect(validateKafkaTopicDraft(draft({ replicationFactor: "-1" }))).toBe("notANumber");
  });

  // retention.ms is the exception: -1 is Kafka's own "keep forever".
  it("accepts -1 for retention because that is what it means", () => {
    expect(validateKafkaTopicDraft(draft({ retentionMs: "-1" }))).toBeNull();
    expect(validateKafkaTopicDraft(draft({ retentionMs: "-2" }))).toBe("notANumber");
  });

  it("refuses something that is not a number at all", () => {
    expect(validateKafkaTopicDraft(draft({ partitions: "three" }))).toBe("notANumber");
  });
});

describe("the free-text settings box", () => {
  it("reads key=value lines", () => {
    expect(parseConfigLines("segment.bytes=1024\nmax.message.bytes=2048")).toEqual({
      "segment.bytes": "1024",
      "max.message.bytes": "2048",
    });
  });

  it("ignores blank lines and comments", () => {
    expect(parseConfigLines("\n# a note\n  \nsegment.bytes=1024\n")).toEqual({
      "segment.bytes": "1024",
    });
  });

  // A value can itself contain an equals sign, so only the first one splits.
  it("splits on the first equals only", () => {
    expect(parseConfigLines("a.b=x=y")).toEqual({ "a.b": "x=y" });
  });

  it("refuses a line that is not a setting", () => {
    expect(parseConfigLines("segment.bytes")).toBeNull();
    expect(parseConfigLines("=1024")).toBeNull();
    expect(validateKafkaTopicDraft(draft({ extraConfigs: "nonsense" }))).toBe("configLine");
  });

  // Two values for one setting is a request the broker cannot answer, so the
  // named field wins and the form never sends both.
  it("lets a named field win over a duplicate typed into the box", () => {
    const input = toKafkaTopicInput(
      draft({ cleanupPolicy: "compact", extraConfigs: "cleanup.policy=delete" }),
    );
    expect(input.configs["cleanup.policy"]).toBe("compact");
  });
});

describe("the submitted topic", () => {
  it("trims the name and carries the settings the form collected", () => {
    const input = toKafkaTopicInput(
      draft({
        name: "  orders.created  ",
        partitions: "6",
        replicationFactor: "3",
        cleanupPolicy: "compact",
        retentionMs: "604800000",
        minInsyncReplicas: "2",
        extraConfigs: "segment.bytes=1073741824",
      }),
    );

    expect(input.name).toBe("orders.created");
    expect(input.partitions).toBe(6);
    expect(input.replicationFactor).toBe(3);
    expect(input.configs).toEqual({
      "cleanup.policy": "compact",
      "retention.ms": "604800000",
      "min.insync.replicas": "2",
      "segment.bytes": "1073741824",
    });
  });
});
