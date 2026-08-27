import { ACTIVE_CONNECTION } from "./connectionScope";
import { TopicService } from "@bindings/bridge";
import type { Destination, DestinationRef } from "./models";
import { present, required } from "./client";

export const getTopics = (): Promise<Destination[]> =>
  TopicService.List(ACTIVE_CONNECTION).then(present);
export const getAllTopics = (): Promise<Destination[]> =>
  TopicService.ListAll(ACTIVE_CONNECTION).then(present);
export const getTopicDetail = (topic: string): Promise<Destination> =>
  TopicService.Detail(ACTIVE_CONNECTION, topic).then(required);
export const getTopicStats = (
  topic: string,
): Promise<Record<string, unknown>> =>
  TopicService.Stats(ACTIVE_CONNECTION, topic);
export const createTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> =>
  TopicService.Create(ACTIVE_CONNECTION, {
    topic,
    brokerAddr,
    readQueue,
    writeQueue,
    perm,
  });
export const updateTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> =>
  TopicService.Update(ACTIVE_CONNECTION, {
    topic,
    brokerAddr,
    readQueue,
    writeQueue,
    perm,
  });
export type { DestinationRef };
export const deleteTopic = (
  topic: string,
  clusterName: string,
): Promise<void> => TopicService.Remove(ACTIVE_CONNECTION, topic, clusterName);
