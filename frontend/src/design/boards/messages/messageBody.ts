/**
 * How a message body is rendered, as a function of the payload and the two
 * message settings.
 *
 * It lives apart from the board because it is the only part of the inspector
 * with a decision in it, and because the three modes times three payload kinds
 * times two settings is more combinations than a panel can be poked into.
 */
import {
  detectBodyKind,
  toHexDump,
  truncatePayload,
  type BodyPreviewKind,
} from "@/lib/time";

/** How the body is rendered: as it decides, as it arrived, or as bytes. */
export const BODY_MODES = ["auto", "raw", "hex"] as const;
export type BodyMode = (typeof BODY_MODES)[number];

export interface BodySettings {
  autoFormatJson: boolean;
  maxPayloadRenderBytes: number;
}

export interface RenderedBody {
  text: string;
  /** True when the text should be syntax-coloured as JSON. */
  json: boolean;
  kind: BodyPreviewKind;
  truncated: boolean;
  originalBytes: number;
}

/**
 * `auto` lets the payload decide: JSON is pretty-printed when 自动格式化 is on,
 * and a payload with too many unprintable bytes is dumped as hex rather than
 * drawn as mojibake. `raw` and `hex` override that.
 *
 * Truncation happens before the mode is applied, so the cap counts the bytes
 * that arrived rather than the ones a hex dump would inflate them to.
 */
export function renderBody(
  raw: string,
  mode: BodyMode,
  settings: BodySettings,
): RenderedBody {
  const kind = detectBodyKind(raw);
  const capped = truncatePayload(raw, settings.maxPayloadRenderBytes);
  const base = {
    kind,
    truncated: capped.truncated,
    originalBytes: capped.originalBytes,
  };

  if (mode === "hex" || (mode === "auto" && kind === "binary")) {
    return { ...base, text: toHexDump(capped.text), json: false };
  }
  if (mode === "auto" && kind === "json" && settings.autoFormatJson) {
    try {
      return {
        ...base,
        text: JSON.stringify(JSON.parse(capped.text), null, 2),
        json: true,
      };
    } catch {
      // A truncated JSON body no longer parses; show what arrived.
      return { ...base, text: capped.text, json: false };
    }
  }
  return { ...base, text: capped.text, json: mode === "auto" && kind === "json" };
}
