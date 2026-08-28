/**
 * The RabbitMQ module.
 *
 * It contributes the queue columns the canonical destinations page shows and
 * the one page that has no canonical counterpart at all.
 */
import { registerModule } from "../registry";
import { MQKind } from "../types";
import { RoutingPage } from "./RoutingPage";

registerModule({
  kind: MQKind.KindRabbitMQ,
  nav: [
    {
      id: "rabbitmq-routing",
      labelKey: "mq.rabbitmq.routing.title",
      page: RoutingPage,
      group: "browse",
    },
  ],
});
