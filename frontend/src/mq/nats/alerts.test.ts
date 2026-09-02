import { describe, expect, it } from "vitest";
import type { Destination, Node, Subscription } from "@/api/models";
import { DEFAULT_ALERT_RULES, rulesFor } from "@/lib/alertRules";
import { MQKind } from "@bindings/model/models";
import { NO_FACTS } from "@/lib/alertDerive";
import { deriveNatsAlerts } from "./alerts";

const THRESHOLDS = { lag: 100, disk: 80 };

/** A replicated stream, as internal/driver/nats/stream.go sends one. */
function stream(over: Partial<Destination> = {}): Destination {
  return {
    id: 1,
    ref: { namespace: "", name: "ORDERS" },
    partitions: -1,
    subscribers: 2,
    depth: 200,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes: {
      clusterName: "e2e",
      leader: "nats-1",
      replicas: "3",
      replicasHealthy: "3",
    },
    ...over,
  } as Destination;
}

function consumer(over: Partial<Subscription> = {}): Subscription {
  return {
    ref: { namespace: "ORDERS", name: "worker" },
    destinations: 1,
    members: -1,
    backlog: 0,
    rateOut: -1,
    status: "online",
    lastUpdated: "",
    attributes: { consumerKind: "pull" },
    ...over,
  } as Subscription;
}

function server(over: Partial<Node> = {}): Node {
  return {
    id: 1,
    name: "nats-1",
    address: "127.0.0.1:4222",
    cluster: "e2e",
    version: "2.14.6",
    status: "online",
    rateIn: -1,
    rateOut: -1,
    diskUsage: -1,
    lastSeen: "",
    replicas: [],
    attributes: { slowConsumers: "0" },
    ...over,
  } as Node;
}

function derive(over: Partial<typeof NO_FACTS>) {
  return deriveNatsAlerts({ ...NO_FACTS, ...over }, DEFAULT_ALERT_RULES, THRESHOLDS);
}

describe("what NATS raises an alert about", () => {
  it("says nothing about a healthy cluster", () => {
    expect(derive({ destinations: [stream()], nodes: [server()] })).toEqual([]);
  });

  /*
   * A stream with no leader takes no publishes and answers no reads, and
   * nothing else on the page shows it: the stream is still listed, still
   * configured, still holding its messages.
   */
  it("raises a stream that has lost its leader", () => {
    const alerts = derive({
      destinations: [stream({ attributes: { clusterName: "e2e", replicas: "3" } })],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("streamNoLeader");
    expect(alerts[0]!.severity).toBe("crit");
  });

  /*
   * A single-server stream has no cluster at all, so leaderlessness is not a
   * state it can be in. Firing here would alert on every stream on every
   * unclustered server, permanently.
   */
  it("says nothing about a stream on a server with no cluster", () => {
    const solo = stream({ attributes: { replicas: "1" } });
    expect(derive({ destinations: [solo] })).toEqual([]);
  });

  it("raises a stream whose replicas are behind", () => {
    const behind = stream({
      attributes: { clusterName: "e2e", leader: "nats-1", replicas: "3", replicasHealthy: "2" },
    });
    const alerts = derive({ destinations: [behind] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("streamUnderReplicated");
    expect(alerts[0]!.severity).toBe("warn");
  });

  /* Leaderless is the worse of the two and says everything the other would. */
  it("raises one alert for a stream that is both leaderless and behind", () => {
    const broken = stream({
      attributes: { clusterName: "e2e", replicas: "3", replicasHealthy: "1" },
    });
    const alerts = derive({ destinations: [broken] });
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["streamNoLeader"]);
  });

  it("raises a consumer past the lag threshold", () => {
    const alerts = derive({ consumerGroups: [consumer({ backlog: 500 })] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("groupLag");
    expect(alerts[0]!.params).toMatchObject({ lag: 500, threshold: 100 });
  });

  /*
   * A pull consumer holds nothing open between polls, so "nothing attached"
   * is how it works. Alerting on it would fire against every healthy pull
   * consumer in the cluster on every sweep that landed between two fetches.
   */
  it("does not call an idle pull consumer unattended", () => {
    const idle = consumer({ backlog: 50, members: -1, attributes: { consumerKind: "pull" } });
    expect(derive({ consumerGroups: [idle] })).toEqual([]);
  });

  /*
   * A push consumer is different: the server has a subject to deliver to and
   * nobody is listening on it, so the work is going nowhere.
   */
  it("raises a push consumer with nothing bound and work waiting", () => {
    const unbound = consumer({
      backlog: 12,
      members: 0,
      attributes: { consumerKind: "push", deliverSubject: "deliver.orders" },
    });
    const alerts = derive({ consumerGroups: [unbound] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("groupOffline");
    expect(alerts[0]!.severity).toBe("crit");
  });

  /* A bound push consumer with a backlog is only behind, not unattended. */
  it("calls a bound push consumer behind rather than unattended", () => {
    const bound = consumer({
      backlog: 500,
      members: 1,
      attributes: { consumerKind: "push", deliverSubject: "deliver.orders" },
    });
    expect(derive({ consumerGroups: [bound] })[0]!.ruleKey).toBe("groupLag");
  });

  /*
   * The counter only goes up, so any value at all means the server has thrown
   * a client off and the messages it missed are gone.
   */
  it("raises a server that has dropped clients for falling behind", () => {
    const dropping = server({ attributes: { slowConsumers: "3" } });
    const alerts = derive({ nodes: [dropping] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("slowConsumer");
    expect(alerts[0]!.params).toMatchObject({ broker: "nats-1", count: 3 });
  });

  it("respects a rule the operator switched off", () => {
    const off = { ...DEFAULT_ALERT_RULES, streamNoLeader: false };
    const broken = stream({ attributes: { clusterName: "e2e", replicas: "3" } });
    expect(deriveNatsAlerts({ ...NO_FACTS, destinations: [broken] }, off, THRESHOLDS)).toEqual([]);
  });

  /*
   * Every rule this file can raise has to be offered as a switch, or it fires
   * with nothing on the settings page able to turn it off.
   */
  it("offers a switch for every rule it can raise", () => {
    const offered = new Set(rulesFor(MQKind.KindNATS));
    const facts = {
      ...NO_FACTS,
      destinations: [
        stream({ attributes: { clusterName: "e2e", replicas: "3" } }),
        stream({
          ref: { namespace: "", name: "EVENTS" },
          attributes: { clusterName: "e2e", leader: "nats-1", replicas: "3", replicasHealthy: "1" },
        }),
      ],
      consumerGroups: [
        consumer({ backlog: 500 }),
        consumer({
          ref: { namespace: "ORDERS", name: "pusher" },
          backlog: 12,
          members: 0,
          attributes: { consumerKind: "push", deliverSubject: "deliver.orders" },
        }),
      ],
      nodes: [server({ attributes: { slowConsumers: "3" } })],
    };
    const raised = new Set(
      deriveNatsAlerts(facts, DEFAULT_ALERT_RULES, THRESHOLDS).map((alert) => alert.ruleKey),
    );
    expect(raised.size).toBe(5);
    for (const key of raised) {
      expect(offered.has(key), key).toBe(true);
    }
  });
});
