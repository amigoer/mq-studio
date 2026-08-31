import { describe, expect, it } from "vitest";
import type { Policy } from "@/api/rabbitmq";
import {
  emptyPolicyForm,
  policyFormOf,
  prettyDefinition,
  toPolicyInput,
  validatePolicy,
} from "./PolicyDialog";

const t = (key: string) => key;

const filled = () => ({
  ...emptyPolicyForm(),
  vhost: "/",
  name: "  order-ttl  ",
  pattern: "  ^order\\.  ",
  definition: '{\n  "message-ttl": 30000\n}',
});

describe("the policy form", () => {
  it("trims the name and pattern and compacts the definition", () => {
    const input = toPolicyInput(filled());
    expect(input.name).toBe("order-ttl");
    expect(input.pattern).toBe("^order\\.");
    expect(input.definition).toBe('{"message-ttl":30000}');
  });

  it("falls back to priority zero rather than sending nothing", () => {
    expect(toPolicyInput({ ...filled(), priority: "" }).priority).toBe(0);
    expect(toPolicyInput({ ...filled(), priority: "10" }).priority).toBe(10);
    // Negative priorities are legitimate: they lose to everything unset.
    expect(toPolicyInput({ ...filled(), priority: "-5" }).priority).toBe(-5);
  });

  it("reads an existing policy back with its definition laid out", () => {
    const form = policyFormOf({
      namespace: "/",
      name: "order-ttl",
      pattern: "^order\\.",
      applyTo: "quorum_queues",
      priority: 5,
      definition: '{"message-ttl":30000}',
      operator: true,
    } as Policy);
    expect(form.applyTo).toBe("quorum_queues");
    expect(form.priority).toBe("5");
    expect(form.operator).toBe(true);
    // Laid out for editing, and compacted again on the way back.
    expect(form.definition).toContain("\n");
    expect(toPolicyInput(form).definition).toBe('{"message-ttl":30000}');
  });

  it("leaves an unparsable definition alone rather than mangling it", () => {
    expect(prettyDefinition("not json")).toBe("not json");
  });
});

describe("what the policy form refuses", () => {
  it("needs a virtual host, a name and a pattern", () => {
    expect(validatePolicy(emptyPolicyForm(), t)).toBe("board.policies.rabbitmq.vhostRequired");
    expect(validatePolicy({ ...emptyPolicyForm(), vhost: "/" }, t)).toBe(
      "board.policies.rabbitmq.nameRequired",
    );
    expect(validatePolicy({ ...emptyPolicyForm(), vhost: "/", name: "p" }, t)).toBe(
      "board.policies.rabbitmq.patternRequired",
    );
  });

  it("refuses a definition that is not valid JSON", () => {
    expect(validatePolicy({ ...filled(), definition: "{oops" }, t)).toBe(
      "board.policies.rabbitmq.definitionInvalid",
    );
  });

  // The broker wants an object; an array is valid JSON and not a definition.
  it("refuses a definition that is not an object", () => {
    expect(validatePolicy({ ...filled(), definition: "[1,2]" }, t)).toBe(
      "board.policies.rabbitmq.definitionNotObject",
    );
  });

  /*
   * An empty definition is accepted by the broker and does nothing: the policy
   * matches queues and changes none of them, which is never what anyone meant
   * and is invisible afterwards.
   */
  it("refuses an empty definition", () => {
    expect(validatePolicy({ ...filled(), definition: "{}" }, t)).toBe(
      "board.policies.rabbitmq.definitionEmpty",
    );
  });

  it("accepts a complete policy", () => {
    expect(validatePolicy(filled(), t)).toBeNull();
  });
});
