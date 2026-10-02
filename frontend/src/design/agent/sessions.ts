import type { TFunction } from "i18next";
import type { AgentSummary } from "@/api/agent";
import { targetOf, titleOf, type Conversation } from "./conversation";

export type Day = "today" | "yesterday" | "earlier";

const dayOf = (moment: Date) => new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime();

/** Which day a conversation last changed, as the list heads its sections. */
export function dayFrom(updated: string, now: Date): Day {
  const days = Math.round((dayOf(now) - dayOf(new Date(updated))) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : "earlier";
}

/**
 * The conversations a search finds, under the day each last changed. They
 * arrive newest first, which is the order kept within each day.
 */
export function sectionsOf(
  summaries: readonly AgentSummary[],
  needle: string,
  now: Date,
): { day: Day; summaries: AgentSummary[] }[] {
  const wanted = needle.trim().toLowerCase();
  const sections: { day: Day; summaries: AgentSummary[] }[] = [];
  for (const summary of summaries) {
    const haystack = `${summary.title} ${summary.connection?.name ?? ""}`.toLowerCase();
    if (wanted !== "" && !haystack.includes(wanted)) continue;
    const day = dayFrom(summary.updated, now);
    const section = sections.find((one) => one.day === day);
    if (section != null) section.summaries.push(summary);
    else sections.push({ day, summaries: [summary] });
  }
  return sections;
}

/**
 * A conversation as Markdown, for a person to keep or pass on: what was said,
 * what was called and what it did, and why a run stopped. The thinking is
 * left out - it is the model's working, not the conversation.
 */
export function transcriptOf(conversation: Conversation, t: TFunction, written: string): string {
  const lines = [`# ${titleOf(conversation) || t("agent.dock.untitled")}`, "", `${conversation.model} · ${written}`];
  let speaking: "you" | "assistant" | null = null;
  const speak = (who: "you" | "assistant") => {
    if (speaking === who) return;
    speaking = who;
    lines.push("", `### ${who === "you" ? t("agent.transcript.you") : t("agent.transcript.assistant")}`, "");
  };
  for (const item of conversation.items) {
    switch (item.kind) {
      case "user":
        speak("you");
        lines.push(item.text ?? "");
        break;
      case "text":
        speak("assistant");
        // Apart from a list of calls above it, which would otherwise take it in.
        lines.push("", item.text ?? "", "");
        break;
      case "tool": {
        const tool = item.tool;
        if (tool == null) break;
        speak("assistant");
        const target = targetOf(tool);
        const parts = [
          t(`agent.tool.${tool.name}`, { defaultValue: tool.title }) + (target != null ? ` \`${target}\`` : ""),
          t(`agent.state.${tool.state}`, { defaultValue: tool.state }),
        ];
        if (tool.result != null && tool.result !== "") parts.push(tool.result);
        lines.push(`- ${parts.join(" · ")}`);
        break;
      }
      case "notice":
        speak("assistant");
        lines.push(
          "",
          `> ${
            item.notice === "limit"
              ? t("agent.notice.limit", { count: Number(item.text) || 0 })
              : t(`agent.notice.${item.notice ?? ""}`)
          }`,
          "",
        );
        break;
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
