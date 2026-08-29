import type { CSSProperties } from "react";
import {
  SiApachekafka,
  SiApachepulsar,
  SiApacherocketmq,
  SiMqtt,
  SiRabbitmq,
  SiRedis,
} from "react-icons/si";
import type { IconType } from "react-icons";
import type { ProtocolId } from "@/design/data/protocols";

/*
 * The canvas pulls these from cdn.simpleicons.org. A packaged desktop app has
 * no network guarantee, so the same Simple Icons glyphs are bundled through
 * react-icons and tinted with each brand's documented hex.
 */
const GLYPH: Record<ProtocolId, { icon: IconType; color: string }> = {
  rocketmq: { icon: SiApacherocketmq, color: "#D77310" },
  kafka: { icon: SiApachekafka, color: "#231F20" },
  rabbitmq: { icon: SiRabbitmq, color: "#FF6600" },
  pulsar: { icon: SiApachepulsar, color: "#188FFF" },
  redis: { icon: SiRedis, color: "#FF4438" },
  mqtt: { icon: SiMqtt, color: "#660066" },
};

export function ProtocolIcon({
  protocol,
  size = 14,
  className = "plogo",
  style,
}: {
  protocol: ProtocolId;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { icon: Icon, color } = GLYPH[protocol];
  return (
    <Icon
      aria-hidden
      className={className}
      size={size}
      color={color}
      style={style}
    />
  );
}
