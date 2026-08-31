import { describe, expect, it } from "vitest";
import { mergeReplication } from "./useRabbitReplication";
import type { FederationUpstream, Shovel } from "@/api/rabbitmq";

/**
 * Shovel and federation are separate plugins, and a broker can have one
 * without the other. The page has to survive that: failing it on the half the
 * broker has no plugin for would hide the half it does.
 */
describe("merging the two halves of the replication page", () => {
  const shovel = { name: "orders-to-archive" } as Shovel;
  const upstream = { name: "eu-west" } as FederationUpstream;

  it("keeps both when both answered", () => {
    expect(mergeReplication([[shovel], [upstream]])).toEqual({
      shovels: [shovel],
      upstreams: [upstream],
    });
  });

  it("draws the upstreams of a broker with no shovel plugin", () => {
    expect(mergeReplication([new Error("404 Object Not Found"), [upstream]])).toEqual({
      shovels: [],
      upstreams: [upstream],
    });
  });

  it("draws the shovels of a broker with no federation plugin", () => {
    expect(mergeReplication([[shovel], new Error("404 Object Not Found")])).toEqual({
      shovels: [shovel],
      upstreams: [],
    });
  });

  // Both failing is a real failure, and an empty page saying nothing is
  // configured would be a lie about a broker that never answered.
  it("fails the page when neither half answered", () => {
    expect(() =>
      mergeReplication([new Error("connection refused"), new Error("connection refused")]),
    ).toThrow("connection refused");
  });
});
