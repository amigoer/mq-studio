import { describe, expect, it } from "vitest";
import type { ClusterOverview, Node } from "@bindings/model/models";
import {
  TOTAL_SLOTS,
  appendOnlyEnabled,
  assignedSlots,
  clusterState,
  connectedClients,
  formatUptime,
  hitRatePercent,
  maxMemoryBytes,
  memoryUsagePercent,
  opsPerSec,
  persistenceHealthy,
  role,
  slotsIncomplete,
  usedMemoryBytes,
} from "./nodes";

function node(attributes: Record<string, string>, overrides: Partial<Node> = {}) {
  return {
    id: 1,
    name: "10.2.0.8:6379",
    address: "10.2.0.8:6379",
    cluster: "",
    version: "8.10.1",
    status: "online",
    rateIn: -1,
    rateOut: -1,
    diskUsage: -1,
    lastSeen: "",
    attributes,
    ...overrides,
  } as unknown as Node;
}

const overview = (attributes: Record<string, string>) =>
  ({
    name: "redis-cluster",
    totalNodes: 6,
    onlineNodes: 6,
    destinations: -1,
    subscriptions: -1,
    avgDiskUsage: -1,
    attributes,
  }) as unknown as ClusterOverview;

describe("the Redis node readers", () => {
  it("reads what the server reported", () => {
    const server = node({
      role: "master",
      connectedClients: "86",
      opsPerSec: "3420",
      usedMemory: "432013312",
      aofEnabled: "1",
    });
    expect(role(server)).toBe("master");
    expect(connectedClients(server)).toBe(86);
    expect(opsPerSec(server)).toBe(3420);
    expect(usedMemoryBytes(server)).toBe(432013312);
    expect(appendOnlyEnabled(server)).toBe(true);
  });

  /*
   * Redis reports 0 for "no memory limit", which is the opposite of what a 0
   * means on a meter. Without this the node board would draw a server with no
   * cap as one that is permanently full.
   */
  it("reads a maxmemory of zero as no cap at all", () => {
    expect(maxMemoryBytes(node({ maxMemory: "0" }))).toBeNull();
    expect(memoryUsagePercent(node({ usedMemory: "100", maxMemory: "0" }))).toBeNull();
    expect(maxMemoryBytes(node({ maxMemory: "2147483648" }))).toBe(2147483648);
  });

  it("computes memory usage against the cap, and caps it at 100", () => {
    expect(memoryUsagePercent(node({ usedMemory: "500", maxMemory: "1000" }))).toBe(50);
    // A server over its own limit happens while eviction catches up; a meter
    // past its end reads as a rendering bug rather than as a full server.
    expect(memoryUsagePercent(node({ usedMemory: "1500", maxMemory: "1000" }))).toBe(100);
  });

  /*
   * Zero hits and zero misses is a server nobody has read from, not one that
   * misses everything. A 0% on a freshly started server would send someone
   * looking for a cache problem that does not exist.
   */
  it("reads a hit rate on a server nobody has read from as unknown", () => {
    expect(hitRatePercent(node({ keyspaceHits: "0", keyspaceMisses: "0" }))).toBeNull();
    expect(hitRatePercent(node({ keyspaceHits: "992", keyspaceMisses: "8" }))).toBe(99.2);
    // Absent counters are unknown too, not zero.
    expect(hitRatePercent(node({}))).toBeNull();
  });

  /*
   * Never having run a snapshot is a different fact from having run one that
   * failed, and the difference is whether anybody needs to do something.
   */
  it("separates a persistence failure from never having run", () => {
    expect(persistenceHealthy(node({}))).toBeNull();
    expect(persistenceHealthy(node({ rdbLastBgsaveStatus: "ok" }))).toBe(true);
    expect(persistenceHealthy(node({ rdbLastBgsaveStatus: "err" }))).toBe(false);
    expect(
      persistenceHealthy(node({ rdbLastBgsaveStatus: "ok", aofLastRewriteStatus: "err" })),
    ).toBe(false);
  });

  /*
   * A cluster can have every node online and still be missing hash slots, and
   * then it cannot serve the keys in them. Nothing in the node list says so.
   */
  it("notices a cluster that is short of slots", () => {
    expect(slotsIncomplete(overview({ clusterSlots: String(TOTAL_SLOTS) }))).toBe(false);
    expect(slotsIncomplete(overview({ clusterSlots: "10923" }))).toBe(true);
    // A standalone server reports no slots at all, which is not a cluster
    // missing them.
    expect(slotsIncomplete(overview({}))).toBe(false);
    expect(assignedSlots(overview({}))).toBeNull();
    expect(clusterState(overview({}))).toBeNull();
    expect(clusterState(overview({ clusterState: "ok" }))).toBe("ok");
  });

  it("scales an uptime to the unit a reader thinks in", () => {
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(600)).toBe("10m");
    expect(formatUptime(7_200)).toBe("2h");
    expect(formatUptime(8_294_400)).toBe("96d");
  });
});
