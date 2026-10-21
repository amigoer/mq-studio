import { describe, expect, it } from "vitest";
import {
  DESTINATION_RULES,
  KINDS_NEEDING_DESTINATIONS,
  KINDS_WITH_OWN_RULES,
  rulesFor,
} from "./alertRules";

/*
 * The sweep and the rules have to agree about which families need a
 * destination listing.
 *
 * Nothing in the language ties them: useAlertCenter decides what to fetch and
 * alertRules decides what can fire, and a family added to the second without
 * the first gets an alerts page that is armed and cannot fire. That is exactly
 * what shipped for ActiveMQ - three destination rules, no destinations swept -
 * and it was found by opening the app against a broker holding 120 undrained
 * messages and seeing "no active alerts".
 */
describe("the rules that read destinations", () => {
  it("are swept for every family that can raise one", () => {
    const needsThem = new Set<string>(KINDS_NEEDING_DESTINATIONS);
    const reads = new Set<string>(DESTINATION_RULES);

    // Only the families that brought their own rules. One on the fallback
    // runs RocketMQ's, which read RocketMQ's facts the RocketMQ way.
    const missing: string[] = [];
    for (const kind of KINDS_WITH_OWN_RULES) {
      const rules = rulesFor(kind);
      if (rules.some((rule) => reads.has(rule)) && !needsThem.has(kind)) {
        missing.push(kind);
      }
    }
    expect(missing).toEqual([]);
  });

  /*
   * And the other way: a family paying for a listing no rule reads is a
   * request per sweep, per connection, per minute, for nothing.
   */
  it("are not swept for a family whose rules never read them", () => {
    const wasted: string[] = [];
    for (const kind of KINDS_NEEDING_DESTINATIONS) {
      const rules = rulesFor(kind);
      if (!rules.some((rule) => (DESTINATION_RULES as readonly string[]).includes(rule))) {
        wasted.push(kind);
      }
    }
    expect(wasted).toEqual([]);
  });
});
