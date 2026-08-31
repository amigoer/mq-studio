import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCompactCount,
  formatCount,
  formatQueues,
  formatRate,
  formatRateWithUnit,
} from "./format";

describe("unreported metrics", () => {
  it("renders a dash rather than zero", () => {
    for (const format of [
      formatRate,
      formatRateWithUnit,
      formatCount,
      formatCompactCount,
    ]) {
      expect(format(-1)).toBe("—");
      expect(format(Number.NaN)).toBe("—");
      expect(format(Number.POSITIVE_INFINITY)).toBe("—");
    }
  });

  it("keeps a real zero reading distinct from a missing one", () => {
    expect(formatRate(0)).toBe("0");
    expect(formatRateWithUnit(0)).toBe("0/s");
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatRate", () => {
  it("rounds small values", () => {
    expect(formatRate(12.4)).toBe("12");
    expect(formatRate(999)).toBe("999");
  });

  it("collapses thousands with two decimals, ten-thousands with one", () => {
    expect(formatRate(1000)).toBe("1.00k");
    expect(formatRate(1234)).toBe("1.23k");
    expect(formatRate(9999)).toBe("10.00k");
    expect(formatRate(10000)).toBe("10.0k");
    expect(formatRate(123456)).toBe("123.5k");
  });

  it("appends the unit only in the with-unit variant", () => {
    expect(formatRateWithUnit(1234)).toBe("1.23k/s");
  });
});

describe("formatCount", () => {
  it("never collapses, so exact totals stay exact", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("formatCompactCount", () => {
  it("stays exact below ten thousand and collapses above", () => {
    expect(formatCompactCount(9999)).toBe("9,999");
    expect(formatCompactCount(10000)).toBe("10.0k");
  });
});

describe("formatQueues", () => {
  it("reports each side independently", () => {
    expect(formatQueues(8, 8)).toBe("8 / 8");
    expect(formatQueues(-1, 8)).toBe("— / 8");
    expect(formatQueues(8, -1)).toBe("8 / —");
    expect(formatQueues(-1, -1)).toBe("—");
  });

  it("keeps a zero queue count visible", () => {
    expect(formatQueues(0, 4)).toBe("0 / 4");
  });
});

/*
 * RabbitMQ reports memory and free disk in bytes, and the figures are large
 * enough to be unreadable raw: a node's memory limit is routinely ten digits.
 */
describe("formatBytes", () => {
  it("scales to the largest unit that leaves a number below 1024", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GiB");
  });

  // One decimal below ten keeps 1.5 GiB from reading as 2 GiB; above ten the
  // fraction is noise.
  it("keeps a decimal only where it changes the reading", () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
    expect(formatBytes(42.4 * 1024 ** 3)).toBe("42 GiB");
  });

  // The attributes arrive as strings, because that is what a driver's
  // attribute map carries.
  it("accepts the string a node attribute holds", () => {
    expect(formatBytes("2048")).toBe("2.0 KiB");
  });

  it("stays a dash for anything unmeasured", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes("not a number")).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

/*
 * formatBytes also formats byte rates, which are fractional. A connection
 * moving 1.6 bytes a second rendered every digit of the float:
 * "1.600000023841858 B/s".
 */
describe("formatBytes on a fractional rate", () => {
  it("rounds a small fraction to one decimal", () => {
    expect(formatBytes(1.600000023841858)).toBe("1.6 B");
    expect(formatBytes(0.5)).toBe("0.5 B");
  });

  it("drops the fraction once the figure is big enough not to need it", () => {
    expect(formatBytes(62.4)).toBe("62 B");
    expect(formatBytes(1023.7)).toBe("1024 B");
  });

  // Byte counts are integers, and they must render exactly as they did.
  it("leaves whole byte counts alone", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
});
