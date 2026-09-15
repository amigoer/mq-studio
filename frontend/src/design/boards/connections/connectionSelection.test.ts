import { describe, expect, it } from "vitest";
import { MQKind } from "@bindings/model/models";
import type { Connection } from "@/design/data/connections";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";
import {
  BULK_ACTIONS,
  bulkTargets,
  clickSelection,
  deletePlan,
  headerChecked,
} from "./connectionSelection";

function row(key: string, extra: Partial<Connection> = {}): Connection {
  return {
    key,
    id: Number(key),
    name: `conn-${key}`,
    protocol: "kafka",
    kind: MQKind.KindKafka,
    protocolLabel: "Kafka",
    address: "127.0.0.1:9092",
    status: "offline",
    lastUsed: "-",
    isDefault: false,
    remark: "",
    ...extra,
  };
}

const rows = ["1", "2", "3", "4", "5"].map((key) => row(key));
const keys = (set: ReadonlySet<string>) => [...set].sort();

describe("a click on a row's checkbox", () => {
  it("toggles that row alone without shift", () => {
    expect(keys(clickSelection(new Set(), rows, "2", null, false))).toEqual(["2"]);
    expect(keys(clickSelection(new Set(["2", "4"]), rows, "2", "4", false))).toEqual(["4"]);
  });

  it("ticks every row from the anchor to the clicked one with shift, in either direction", () => {
    expect(keys(clickSelection(new Set(["2"]), rows, "4", "2", true))).toEqual(["2", "3", "4"]);
    expect(keys(clickSelection(new Set(["4"]), rows, "2", "4", true))).toEqual(["2", "3", "4"]);
  });

  it("clears the range when the clicked row was ticked", () => {
    // The clicked row decides the direction, so going back over a range undoes it.
    const all = new Set(rows.map((c) => c.key));
    expect(keys(clickSelection(all, rows, "4", "2", true))).toEqual(["1", "5"]);
  });

  it("falls back to a toggle when the anchor is no longer on screen", () => {
    // A filter can hide the row the last click was on.
    expect(keys(clickSelection(new Set(), rows, "3", "9", true))).toEqual(["3"]);
  });
});

describe("the header checkbox", () => {
  it("is clear, partial or ticked by how much of the visible list is selected", () => {
    expect(headerChecked(rows, new Set())).toBe(false);
    expect(headerChecked(rows, new Set(["1"]))).toBe("indeterminate");
    expect(headerChecked(rows, new Set(rows.map((c) => c.key)))).toBe(true);
  });

  it("ignores selected keys the list is not showing", () => {
    expect(headerChecked(rows.slice(0, 2), new Set(["1", "2", "5"]))).toBe(true);
  });
});

describe("what a bulk action reaches", () => {
  const mixed = [
    row("1", { status: "online" }),
    row("2", { status: "offline" }),
    row("3", { status: "failed" }),
    row("4", { status: "offline" }),
  ];
  const ids = (connections: readonly Connection[]) => connections.map((c) => c.key);

  it("dials what is not up, and closes what is", () => {
    expect(ids(bulkTargets("connect", mixed))).toEqual(["2", "3", "4"]);
    expect(ids(bulkTargets("disconnect", mixed))).toEqual(["1"]);
    expect(ids(bulkTargets("test", mixed))).toEqual(["1", "2", "3", "4"]);
  });

  it("leaves a row that is already busy to finish", () => {
    const pending = { 2: "connecting", 1: "testing" } as const;
    expect(ids(bulkTargets("connect", mixed, pending))).toEqual(["3", "4"]);
    expect(ids(bulkTargets("disconnect", mixed, pending))).toEqual([]);
    expect(ids(bulkTargets("test", mixed, pending))).toEqual(["3", "4"]);
  });

  it("deletes a busy row all the same, as the row's own menu does", () => {
    expect(ids(bulkTargets("delete", mixed, { 2: "connecting" }))).toEqual(["1", "2", "3", "4"]);
  });
});

describe("a bulk delete's plan", () => {
  const home = row("1", { isDefault: true });
  const others = [row("2"), row("3")];

  it("takes the default last when every profile is going", () => {
    // Go refuses the default while any other profile remains, and by the end
    // of this run none does.
    const plan = deletePlan([home, ...others], 3);
    expect(plan.order.map((c) => c.key)).toEqual(["2", "3", "1"]);
    expect(plan.kept).toBeUndefined();
  });

  it("keeps the default out when some profile stays behind", () => {
    const plan = deletePlan([home, others[0]!], 3);
    expect(plan.order.map((c) => c.key)).toEqual(["2"]);
    expect(plan.kept?.key).toBe("1");
  });

  it("runs as selected when the default is not among them", () => {
    expect(deletePlan(others, 3)).toEqual({ order: others });
  });
});

/*
 * The runner and the bar build these keys from the action's name, so the key
 * sweep in i18n/keys.test.ts, which only reads literals, never sees them.
 */
describe.each([
  ["zh", zh],
  ["en", en],
] as const)("the %s wording for each bulk action", (_language, bundle) => {
  it("exists for every action and every stage of a run", () => {
    const bulk = (bundle.page.connections as unknown as { bulk: Record<string, Record<string, string>> }).bulk;
    for (const stage of ["running", "done", "failed"]) {
      for (const action of BULK_ACTIONS) {
        expect(typeof bulk[stage]?.[action], `${stage}.${action}`).toBe("string");
      }
    }
  });
});
