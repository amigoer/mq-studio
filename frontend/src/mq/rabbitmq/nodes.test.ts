import { describe, expect, it } from "vitest";
import type { Node } from "@bindings/model/models";
import {
  diskFreeAlarm,
  diskHeadroomUsage,
  memoryAlarm,
  memoryUsage,
  partitions,
} from "./nodes";

const node = (attributes: Record<string, string>): Node =>
  ({ name: "rabbit@one", attributes }) as unknown as Node;

describe("RabbitMQ node readers", () => {
  // The broker knows the watermark it blocks publishers at and how much it is
  // using against it, so this is a real fraction rather than an estimate.
  it("reads memory as a fraction of the node's own high watermark", () => {
    expect(memoryUsage(node({ memoryUsed: "512", memoryLimit: "1024" }))).toBe(50);
  });

  // A node over its watermark reports more used than the limit. Letting the
  // meter run past 100 would draw outside its own track.
  it("caps memory at the watermark rather than overflowing the meter", () => {
    expect(memoryUsage(node({ memoryUsed: "2048", memoryLimit: "1024" }))).toBe(100);
  });

  // No limit means the figure is not a fraction of anything. Null is what the
  // board reads as "do not draw a meter", which is not the same as zero.
  it("has no memory figure when the broker reports no limit", () => {
    expect(memoryUsage(node({ memoryUsed: "512", memoryLimit: "0" }))).toBeNull();
    expect(memoryUsage(node({}))).toBeNull();
  });

  /*
   * Disk is not memory. RabbitMQ never reports the size of the disk, only how
   * much is free and the floor it alarms at, so there is no usage percentage
   * to compute - this is how close free space has come to that floor.
   */
  it("reads disk as headroom against the alarm floor, not as usage", () => {
    // Sitting exactly on the limit: no headroom left.
    expect(diskHeadroomUsage(node({ diskFree: "1000", diskFreeLimit: "1000" }))).toBe(100);
    // Ten times the floor free: comfortable.
    expect(diskHeadroomUsage(node({ diskFree: "10000", diskFreeLimit: "1000" }))).toBe(10);
    // Below the floor already; the meter is full rather than past full.
    expect(diskHeadroomUsage(node({ diskFree: "500", diskFreeLimit: "1000" }))).toBe(100);
  });

  it("has no disk figure when the broker reports no floor", () => {
    expect(diskHeadroomUsage(node({ diskFree: "1000", diskFreeLimit: "0" }))).toBeNull();
  });

  it("reads the alarm flags", () => {
    expect(memoryAlarm(node({ memoryAlarm: "true" }))).toBe(true);
    expect(memoryAlarm(node({ memoryAlarm: "false" }))).toBe(false);
    expect(diskFreeAlarm(node({ diskFreeAlarm: "true" }))).toBe(true);
  });

  /*
   * A non-empty partition list is a split brain, and it is the single most
   * important thing a node can be saying. An absent attribute and an empty
   * list mean the same thing here - nobody lost - so both give an empty array
   * rather than one giving [""].
   */
  it("reads partitions, treating absent and empty alike", () => {
    expect(partitions(node({ partitions: "rabbit@two,rabbit@three" }))).toEqual([
      "rabbit@two",
      "rabbit@three",
    ]);
    expect(partitions(node({ partitions: "" }))).toEqual([]);
    expect(partitions(node({}))).toEqual([]);
  });
});
