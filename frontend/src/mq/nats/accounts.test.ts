import { describe, expect, it } from "vitest";
import type { Namespace } from "@bindings/model/models";
import {
  connections,
  hasJetStream,
  isSystemAccount,
  memoryLimit,
  readVia,
  serversReporting,
  storageLimit,
  storageUsed,
  usedPercent,
} from "./accounts";

/**
 * The attribute keys are a contract with internal/driver/nats/account.go, so
 * the fixture is what that file writes rather than what is convenient here.
 */
function account(over: Partial<Namespace> = {}): Namespace {
  return {
    name: "APP",
    description: "",
    tags: [],
    defaultQueueType: "",
    tracing: false,
    messages: -1,
    ready: -1,
    unacknowledged: -1,
    limits: { maxStorage: 1048576 },
    attributes: {
      readVia: "system",
      serversReporting: "3",
      jetstream: "true",
      connections: "4",
      subscriptions: "18",
      jetstreamStorage: "262144",
    },
    ...over,
  } as Namespace;
}

describe("reading a NATS account", () => {
  it("reads the counts the driver wrote", () => {
    const app = account();
    expect(connections(app)).toBe(4);
    expect(storageUsed(app)).toBe(262144);
    expect(readVia(app)).toBe("system");
    expect(serversReporting(app)).toBe(3);
    expect(hasJetStream(app)).toBe(true);
  });

  /*
   * Only the account named as the system one is marked. An empty name
   * compared for equality would mark every row, which is what the driver's
   * side of this guards against too.
   */
  it("marks only the system account", () => {
    expect(isSystemAccount(account())).toBe(false);
    expect(
      isSystemAccount(account({ attributes: { systemAccount: "true" } })),
    ).toBe(true);
  });

  /*
   * An absent limit is uncapped, and a limit of zero is an account granted
   * JetStream with no allowance. The model keeps them apart on purpose.
   */
  it("tells an uncapped account from one capped at zero", () => {
    expect(memoryLimit(account())).toBeNull();
    expect(storageLimit(account())).toBe(1048576);
    expect(storageLimit(account({ limits: { maxStorage: 0 } }))).toBe(0);
  });

  /*
   * A meter needs both halves. With no cap there is nothing to draw against,
   * and a bar rendered anyway would sit empty and read as plenty of room.
   */
  it("draws no meter without a cap to draw it against", () => {
    expect(usedPercent(262144, 1048576)).toBe(25);
    expect(usedPercent(262144, null)).toBeNull();
    expect(usedPercent(null, 1048576)).toBeNull();
    expect(usedPercent(262144, 0)).toBeNull();
  });

  it("clamps a meter that has passed its cap", () => {
    expect(usedPercent(2097152, 1048576)).toBe(100);
  });

  /* A row read before an attribute existed must not throw. */
  it("reads an account with no attributes at all", () => {
    const bare = account({ attributes: {}, limits: {} });
    expect(connections(bare)).toBeNull();
    expect(hasJetStream(bare)).toBe(false);
    expect(readVia(bare)).toBeNull();
  });
});
