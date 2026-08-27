/**
 * The RocketMQ module.
 *
 * It is the reference implementation: everything the canonical pages show for
 * RocketMQ that another family would show differently, or not at all, lives
 * here rather than in the pages.
 */
import { registerModule } from '../registry'
import { MQKind } from '../types'

registerModule({
  kind: MQKind.KindRocketMQ,
})
