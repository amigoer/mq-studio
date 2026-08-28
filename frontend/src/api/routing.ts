import { RoutingService } from "@bindings/bridge";
import type { Binding, Destination } from "./models";
import { ACTIVE_CONNECTION } from "./connectionScope";
import { present } from "./client";

/** The exchanges in a namespace. */
export const getExchanges = (namespace = ""): Promise<Destination[]> =>
  RoutingService.Exchanges(ACTIVE_CONNECTION, namespace).then(present);

/** The routes in a namespace. */
export const getBindings = (namespace = ""): Promise<Binding[]> =>
  RoutingService.Bindings(ACTIVE_CONNECTION, namespace).then(present);
