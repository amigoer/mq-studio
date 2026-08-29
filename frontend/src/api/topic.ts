import { TopicService } from "@bindings/bridge";
import type { Destination, DestinationRef } from "./models";
import { present, required } from "./client";

export const getTopics = (connID: number): Promise<Destination[]> =>
  TopicService.List(connID).then(present);
export const getAllTopics = (connID: number): Promise<Destination[]> =>
  TopicService.ListAll(connID).then(present);
export const getTopicDetail = (connID: number, topic: string): Promise<Destination> =>
  TopicService.Detail(connID, topic).then(required);
export const getTopicStats = (
  connID: number,
  topic: string,
): Promise<Record<string, unknown>> =>
  TopicService.Stats(connID, topic);
export const createTopic = (
  connID: number,
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> =>
  TopicService.Create(connID, {
    topic,
    brokerAddr,
    readQueue,
    writeQueue,
    perm,
  });
export const updateTopic = (
  connID: number,
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> =>
  TopicService.Update(connID, {
    topic,
    brokerAddr,
    readQueue,
    writeQueue,
    perm,
  });
export type { DestinationRef };
export const deleteTopic = (
  connID: number,
  topic: string,
  clusterName: string,
): Promise<void> => TopicService.Remove(connID, topic, clusterName);
