import { RoutingService } from "@bindings/bridge";
import type { Binding, Destination } from "./models";
import { present } from "./client";

/** The exchanges in a namespace. */
export const getExchanges = (connID: number, namespace = ""): Promise<Destination[]> =>
  RoutingService.Exchanges(connID, namespace).then(present);

/** The routes in a namespace. */
export const getBindings = (connID: number, namespace = ""): Promise<Binding[]> =>
  RoutingService.Bindings(connID, namespace).then(present);
