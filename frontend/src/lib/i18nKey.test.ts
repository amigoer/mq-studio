import { describe, expect, it } from "vitest";
import { isI18nKey } from "./utils";

/**
 * A driver reports a reason the user can act on as an i18n key, and the
 * renderer turns it into a sentence in their language. Everything else a board
 * can fail with is already a sentence, and handing one of those to i18next
 * would let it split on the separators it reserves - `:` for a namespace and
 * `.` for a nested key.
 */
describe("telling a degraded reason from an error message", () => {
  it("recognises the keys the drivers actually emit", () => {
    for (const key of [
      "mq.rabbitmq.degraded.credentials",
      "mq.rabbitmq.degraded.replicationPlugin",
      "mq.rabbitmq.degraded.streamPlugin",
      "mq.rabbitmq.caveat.browseAltersQueue",
      "mq.rocketmq.degraded.proxyEndpoint",
    ]) {
      expect(isI18nKey(key), key).toBe(true);
    }
  });

  it("leaves a real error message alone", () => {
    for (const message of [
      "connection refused",
      "management API returned 500 Internal Server Error",
      "Exception: something.went.wrong",
      "dial tcp 127.0.0.1:15672: connect: connection refused",
      "rabbitmq does not support offset.reset",
      "404 Object Not Found",
      "",
    ]) {
      expect(isI18nKey(message), message).toBe(false);
    }
  });
});
