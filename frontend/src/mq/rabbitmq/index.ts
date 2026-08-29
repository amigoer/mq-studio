/**
 * The RabbitMQ module.
 *
 * It contributes the queue columns the canonical destinations page shows. The
 * one page with no canonical counterpart at all -- exchanges and bindings --
 * is drawn in the design layer as a board and has no wired page to register
 * yet, so the nav contribution comes back with it.
 */
import { registerModule } from "../registry";
import { MQKind } from "../types";

registerModule({ kind: MQKind.KindRabbitMQ });
