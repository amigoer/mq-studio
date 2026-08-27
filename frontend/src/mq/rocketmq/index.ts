/**
 * The RocketMQ module.
 *
 * It is the reference implementation: everything the canonical pages show for
 * RocketMQ that another family would show differently, or not at all, lives
 * here rather than in the pages.
 */
import { registerModule } from '../registry'
import { MQKind } from '../types'
import { registerValidator } from '../validators'
import { isValidNsHost } from './endpoints'

// The descriptor's endpoint field names this check; only this module knows
// what a valid name server address looks like.
registerValidator('host-port', isValidNsHost)

registerModule({
  kind: MQKind.KindRocketMQ,
})
