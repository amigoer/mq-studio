import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

/**
 * Every reason a driver can report has to resolve to a sentence.
 *
 * keys.test.ts cannot see these. It scans the sources for literal `t("…")`
 * calls, and a degraded reason never appears in one: the driver sends the key
 * across the bridge and the sidebar resolves whatever arrives. So a missing
 * one is invisible to the whole test suite and shows up only as a tooltip
 * reading "mq.mqtt.degraded.managementAbsent" at somebody who wanted to know
 * why a page was blocked — which is what happened.
 *
 * The lists below are the constants each driver declares. They are duplicated
 * here on purpose, the same way the sidebar capability contract is: nothing in
 * either language ties a Go string to a JSON key, so the only thing that can
 * catch a rename is a second copy that goes red.
 */
const REASONS: Record<string, string[]> = {
  // internal/driver/mqtt/conn.go and management.go
  mqtt: [
    "sysRefused",
    "sysSilent",
    "managementAbsent",
    "managementUnreachable",
    "managementCredentials",
    "managementUnknown",
  ],
  // internal/driver/kafka/conn.go
  kafka: ["credentials", "forbidden", "timeout", "accessControl", "unreachable"],
  // internal/driver/nats/conn.go
  //
  // Six rather than three, because each pair is one tier that can be missing
  // two ways, and the two ways have different fixes. A server built without
  // JetStream is not an account denied it; an endpoint nobody named is not one
  // that did not answer; credentials never given are not credentials refused.
  nats: [
    "jetstreamDisabled",
    "jetstreamNoAccount",
    "monitorAbsent",
    "monitorUnreachable",
    "systemAbsent",
    "systemForbidden",
  ],
};

type Bundle = Record<string, unknown>;

function resolve(bundle: Bundle, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node != null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    );
}

/**
 * How short is too short, per language.
 *
 * Chinese carries about three times as much per character, so one threshold
 * flags perfectly good Chinese: "集群接受了连接，但没有在超时时间内应答。" is a
 * complete sentence in twenty characters and its English is sixty-three.
 */
const FLOOR: Record<string, number> = { en: 30, zh: 12 };

describe.each([
  ["en", en as Bundle],
  ["zh", zh as Bundle],
])("the %s bundle", (language, bundle) => {
  it("has a sentence for every degraded reason a driver reports", () => {
    const missing: string[] = [];
    for (const [kind, reasons] of Object.entries(REASONS)) {
      for (const reason of reasons) {
        const key = `mq.${kind}.degraded.${reason}`;
        if (typeof resolve(bundle, key) !== "string") missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  // A reason is read by somebody who has just been stopped from opening a
  // page. "Not supported" tells them nothing they did not already know.
  it("says what to do rather than only what is wrong", () => {
    const tooShort: string[] = [];
    for (const [kind, reasons] of Object.entries(REASONS)) {
      for (const reason of reasons) {
        const key = `mq.${kind}.degraded.${reason}`;
        const text = resolve(bundle, key);
        if (typeof text === "string" && text.length < (FLOOR[language] ?? 30)) {
          tooShort.push(key);
        }
      }
    }
    expect(tooShort).toEqual([]);
  });
});
