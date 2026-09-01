import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real Redis Stream connection draws.
 *
 * The last thing between a working driver and a working app: every page is
 * wired, and the one that decides whether you can reach it is this derivation.
 * A capability dropped on the Go side, or a `requires` entry naming the wrong
 * one, takes a whole finished page out of the app and nothing else notices.
 *
 * The list below is what `capabilities()` in
 * internal/driver/redisstream/conn.go declares. A Go test asserts the driver
 * still declares exactly this, so the two halves cannot drift apart without
 * one of them failing.
 */
const REDIS_CAPABILITIES: Capability[] = [
  Capability.CapDestinationList,
  Capability.CapDestinationCreate,
  Capability.CapDestinationDelete,
  Capability.CapStreamTrim,
];

function state(
  supported: Capability[],
  degraded: Partial<Record<Capability, string>> = {},
): CapabilityState {
  return {
    has: (capability) => supported.includes(capability),
    degradedReason: (capability) => degraded[capability],
    caveat: () => undefined,
    loading: false,
  };
}

/** Every page the Redis sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.redis.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar a Redis Stream connection draws", () => {
  it("reaches the pages the driver has ports for so far", () => {
    const nav = navAvailability(state(REDIS_CAPABILITIES), true);
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));

    // Overview and alerts stand on their own; streams is the page this
    // capability set exists for. The rest arrive with their ports.
    expect(reachable).toEqual(["overview", "topics"]);
  });

  /*
   * A page whose capability the family has no concept of is not drawn at all,
   * as opposed to drawn and greyed out. Redis has no exchanges and no virtual
   * hosts, and a sidebar offering them would describe a different broker.
   */
  it("does not draw pages Redis has no concept of", () => {
    const nav = navAvailability(state(REDIS_CAPABILITIES), true);
    for (const id of ["exchanges", "vhosts", "policies", "replication", "definitions", "quotas"]) {
      expect(nav.visible(id), id).toBe(false);
    }
    // And none of them is in the sidebar this protocol declares either.
    expect(drawn).not.toContain("exchanges");
    expect(drawn).not.toContain("vhosts");
  });

  /*
   * Nothing is dialled yet, so nothing is known. Hiding pages that would come
   * back the moment a connection opens reads as an app with no features.
   */
  it("draws every page while the connection is not open", () => {
    const nav = navAvailability(state([]), false);
    for (const id of drawn) {
      expect(nav.visible(id), id).toBe(true);
      expect(nav.disabled(id), id).toBe(false);
    }
  });

  /*
   * A server that refused the credential degrades everything, and the sidebar
   * has to stay drawn with the reason on it: an empty one reads as an app with
   * no features rather than an endpoint that needs a password fixed.
   */
  it("keeps the stream page drawn and disabled when the credential was refused", () => {
    const nav = navAvailability(
      state(
        [],
        Object.fromEntries(
          REDIS_CAPABILITIES.map((capability) => [
            capability,
            "mq.redis-stream.degraded.credentials",
          ]),
        ),
      ),
      true,
    );

    expect(nav.visible("topics")).toBe(true);
    expect(nav.disabled("topics")).toBe(true);
    expect(nav.reason("topics")).toBe("mq.redis-stream.degraded.credentials");
    // Overview stands on its own and stays reachable to say what is wrong.
    expect(nav.disabled("overview")).toBe(false);
  });
});
