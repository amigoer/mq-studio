import { describe, expect, it } from "vitest";
import type { Namespace } from "@/api/rabbitmq";
import { emptyVhostForm, toNamespaceInput, validateVhost, vhostFormOf } from "./VhostDialog";

const t = (key: string) => key;

describe("the virtual host form", () => {
  /*
   * Quorum by default on a new virtual host. Most client libraries declare
   * queues without a type, so whatever this is set to is what nearly every
   * queue in the vhost becomes - and the broker's own default is classic,
   * which is lost with the node holding it.
   */
  it("defaults a new virtual host to quorum queues", () => {
    expect(emptyVhostForm().defaultQueueType).toBe("quorum");
  });

  it("trims the name and description", () => {
    const input = toNamespaceInput({
      ...emptyVhostForm(),
      name: "  /orders  ",
      description: "  order processing  ",
    });
    expect(input.name).toBe("/orders");
    expect(input.description).toBe("order processing");
  });

  it("splits tags and drops the empty ones", () => {
    const input = toNamespaceInput({ ...emptyVhostForm(), name: "x", tags: "prod, , orders ," });
    expect(input.tags).toEqual(["prod", "orders"]);
  });

  // An empty default type means the broker's own, which is a real choice and
  // must reach it as an empty string rather than being filled in here.
  it("sends an empty default type as the broker's own", () => {
    const input = toNamespaceInput({ ...emptyVhostForm(), name: "x", defaultQueueType: "" });
    expect(input.defaultQueueType).toBe("");
  });

  it("reads an existing virtual host back into the form", () => {
    const vhost = {
      name: "/orders",
      description: "order processing",
      tags: ["prod", "orders"],
      defaultQueueType: "quorum",
      tracing: true,
      messages: 0,
      ready: 0,
      unacknowledged: 0,
      limits: {},
    } as unknown as Namespace;

    const form = vhostFormOf(vhost);
    expect(form.name).toBe("/orders");
    expect(form.tags).toBe("prod, orders");
    expect(form.tracing).toBe(true);
    // And back out unchanged, so opening the dialog and saving is a no-op.
    expect(toNamespaceInput(form).tags).toEqual(["prod", "orders"]);
  });

  it("needs a name", () => {
    expect(validateVhost(emptyVhostForm(), t)).toBe("board.vhosts.rabbitmq.nameRequired");
    expect(validateVhost({ ...emptyVhostForm(), name: "/orders" }, t)).toBeNull();
  });
});
