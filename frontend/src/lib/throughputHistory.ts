import type { Node } from "@/api/models";

export const THROUGHPUT_HISTORY_MINUTES = 60;
export const THROUGHPUT_SAMPLE_MS = 60_000;
const THROUGHPUT_CONTINUOUS_GAP_MS = THROUGHPUT_SAMPLE_MS * 2;

export interface ThroughputHistory {
  timestamps: number[];
  inbound: number[];
  outbound: number[];
}

export function aggregateThroughputHistory(
  brokers: Node[],
  now: number = Date.now(),
): ThroughputHistory {
  const windowEnd =
    Math.floor(now / THROUGHPUT_SAMPLE_MS) * THROUGHPUT_SAMPLE_MS;
  const windowStart =
    windowEnd - (THROUGHPUT_HISTORY_MINUTES - 1) * THROUGHPUT_SAMPLE_MS;
  const buckets = new Map<number, { inbound: number; outbound: number }>();

  for (const broker of brokers) {
    const inbound = broker.tpsInHistory ?? [];
    const outbound = broker.tpsOutHistory ?? [];
    const sampleCount = Math.max(inbound.length, outbound.length);
    if (sampleCount === 0) continue;

    const rawTimestamps = broker.tpsHistoryTimestamps ?? [];
    const fallbackStart = windowEnd - (sampleCount - 1) * THROUGHPUT_SAMPLE_MS;
    for (let index = 0; index < sampleCount; index++) {
      const timestampIndex = rawTimestamps.length - sampleCount + index;
      const rawTimestamp =
        timestampIndex >= 0 ? rawTimestamps[timestampIndex] : undefined;
      const timestamp =
        rawTimestamp == null
          ? fallbackStart + index * THROUGHPUT_SAMPLE_MS
          : toMillis(rawTimestamp);
      const bucketTimestamp =
        Math.floor(timestamp / THROUGHPUT_SAMPLE_MS) * THROUGHPUT_SAMPLE_MS;
      if (bucketTimestamp < windowStart || bucketTimestamp > windowEnd)
        continue;

      const inboundIndex = inbound.length - sampleCount + index;
      const outboundIndex = outbound.length - sampleCount + index;
      const point = buckets.get(bucketTimestamp) ?? { inbound: 0, outbound: 0 };
      point.inbound += validTPS(inboundIndex >= 0 ? inbound[inboundIndex] : 0);
      point.outbound += validTPS(
        outboundIndex >= 0 ? outbound[outboundIndex] : 0,
      );
      buckets.set(bucketTimestamp, point);
    }
  }

  const timestamps = [...buckets.keys()].sort((left, right) => left - right);
  return {
    timestamps,
    inbound: timestamps.map(
      (timestamp) => buckets.get(timestamp)?.inbound ?? 0,
    ),
    outbound: timestamps.map(
      (timestamp) => buckets.get(timestamp)?.outbound ?? 0,
    ),
  };
}

export function continuousHistoryRanges(
  timestamps: number[],
  maxGap: number = THROUGHPUT_CONTINUOUS_GAP_MS,
): Array<{ start: number; end: number }> {
  if (timestamps.length === 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 1; index < timestamps.length; index++) {
    if ((timestamps[index] ?? 0) - (timestamps[index - 1] ?? 0) <= maxGap)
      continue;
    ranges.push({ start, end: index - 1 });
    start = index;
  }
  ranges.push({ start, end: timestamps.length - 1 });
  return ranges;
}

export function throughputWindow(now: number = Date.now()): {
  start: number;
  end: number;
} {
  const end = Math.floor(now / THROUGHPUT_SAMPLE_MS) * THROUGHPUT_SAMPLE_MS;
  return {
    start: end - (THROUGHPUT_HISTORY_MINUTES - 1) * THROUGHPUT_SAMPLE_MS,
    end,
  };
}

function toMillis(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function validTPS(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? Number(value) : 0;
}
