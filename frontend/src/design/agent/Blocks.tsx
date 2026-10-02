import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Info,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { JsonBlock, JsonText, OutlineTag } from "@/components";
import { Markdown } from "@/components/markdown";
import { copyText } from "@/api/platform";
import type { AgentItem, AgentToolItem } from "@/api/agent";
import { protocolOfKind } from "@/design/data/connections";
import { PROTOCOLS } from "@/design/data/protocols";
import { failureKey } from "@/design/boards/settings/assistantForm";
import { cn } from "@/lib/utils";
import { secondsOf, targetOf } from "./conversation";

/** A tool as a person knows it: its name in their language, or Go's title. */
function useToolName() {
  const { t } = useTranslation();
  return (tool: AgentToolItem) => t(`agent.tool.${tool.name}`, { defaultValue: tool.title });
}

const familyOf = (kind: string | undefined): string => {
  const protocol = kind == null ? null : protocolOfKind(kind as Parameters<typeof protocolOfKind>[0]);
  return protocol != null ? PROTOCOLS[protocol].name : (kind ?? "");
};

export function UserMessage({ item, chips }: { item: AgentItem; chips: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {chips}
      <div className="max-w-[88%] rounded-xl bg-(--c-fill) px-3 py-2 text-[13px] leading-[1.6] break-words whitespace-pre-wrap">
        {item.text}
      </div>
    </div>
  );
}

export function Answer({ item }: { item: AgentItem }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/answer relative">
      <Markdown source={item.text ?? ""} tone="answer" className="[&>*:last-child]:mb-0" />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? t("agent.dock.copied") : t("agent.dock.copy")}
        className="absolute top-0 right-0 bg-background text-muted-foreground opacity-0 group-hover/answer:opacity-100 focus-visible:opacity-100"
        onClick={() =>
          void copyText(item.text ?? "").then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function Thinking({ item, live }: { item: AgentItem; live: boolean }) {
  const { t } = useTranslation();
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/thinking flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
        {live ? <LoaderCircle className="size-3.5 animate-spin" /> : <Brain className="size-3.5" />}
        <span>{live ? t("agent.thinking.live") : t("agent.thinking.label")}</span>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/thinking:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 border-l-2 pl-2.5 text-[12px] leading-[1.7] whitespace-pre-wrap text-muted-foreground">
          {item.text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StateIcon({ state }: { state: string }) {
  switch (state) {
    case "running":
    case "waiting":
      return <LoaderCircle className="size-3.5 flex-none animate-spin text-muted-foreground" />;
    case "done":
      return <Check className="size-3.5 flex-none text-(--c-ok)" />;
    case "failed":
      return <X className="size-3.5 flex-none text-(--c-err-text)" />;
    default:
      return <CircleSlash className="size-3.5 flex-none text-muted-foreground" />;
  }
}

/** The call's arguments and answer, for a person checking its work. */
function CallDetails({ tool }: { tool: AgentToolItem }) {
  const { t } = useTranslation();
  const json = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return (
    <div className="flex flex-col gap-1.5 pt-1.5 pb-1 text-[11px]">
      <span className="text-muted-foreground">{t("agent.tools.input")}</span>
      <JsonBlock className="max-h-40 overflow-auto px-2.5 py-2 text-[11px]">
        <JsonText>{json(tool.input)}</JsonText>
      </JsonBlock>
      {tool.output != null && (
        <>
          <span className="text-muted-foreground">{t("agent.tools.output")}</span>
          <JsonBlock className="max-h-56 overflow-auto px-2.5 py-2 text-[11px]">
            <JsonText>{json(tool.output)}</JsonText>
          </JsonBlock>
        </>
      )}
    </div>
  );
}

/** Reads in a row, folded into one line until opened. */
export function Reads({ items }: { items: AgentItem[] }) {
  const { t } = useTranslation();
  const nameOf = useToolName();
  const running = items.find((item) => item.tool?.state === "running");
  return (
    <Collapsible className="rounded-lg border bg-(--c-panel)">
      <CollapsibleTrigger className="group/reads flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted-foreground hover:text-foreground">
        {running != null ? (
          <LoaderCircle className="size-3.5 flex-none animate-spin" />
        ) : (
          <Wrench className="size-3.5 flex-none" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {running?.tool != null
            ? t("agent.tools.calling", { name: nameOf(running.tool) })
            : t("agent.tools.called", { count: items.length })}
        </span>
        <span className="mono3 text-[11px]">{secondsOf(items)}</span>
        <ChevronRight className="size-3.5 flex-none transition-transform group-data-[state=open]/reads:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-1">
        {items.map((item) => {
          const tool = item.tool!;
          const target = targetOf(tool);
          return (
            <Collapsible key={item.id}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-[12px]">
                <StateIcon state={tool.state} />
                <span className="flex-none">{nameOf(tool)}</span>
                {target != null && <span className="mono3 min-w-0 truncate text-muted-foreground">{target}</span>}
                <span className="flex-1" />
                {tool.ms != null && (
                  <span className="mono3 flex-none text-[11px] text-muted-foreground">{(tool.ms / 1000).toFixed(2)}s</span>
                )}
              </CollapsibleTrigger>
              {tool.state === "failed" && tool.result != null && (
                <p className="pb-1 pl-5.5 text-[11.5px] text-(--c-err-text)">{tool.result}</p>
              )}
              <CollapsibleContent>
                <CallDetails tool={tool} />
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A write's arguments as the card lists them, the connection apart. */
export function fieldsOf(input: unknown): [string, string][] {
  if (input == null || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => key !== "connection" && value != null && value !== "" && value !== false)
    .map(([key, value]) => {
      if (key === "timestamp" && typeof value === "number") return [key, new Date(value).toLocaleString()];
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return [key, text.length > 240 ? `${text.slice(0, 240)}…` : text];
    });
}

const DESTROY_LABEL: Record<string, string> = {
  destination_purge: "agent.write.purge",
  destination_delete: "agent.write.delete",
};

/**
 * A write: the question while it waits on the person, and what it did once
 * it has run. An approval is the person's to give once or for the rest of
 * the conversation; a destruction is confirmed every time, with the
 * question the audit log keeps word for word.
 */
export function Write({
  item,
  onDecide,
}: {
  item: AgentItem;
  onDecide: (approve: boolean, remember: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useToolName();
  const [remember, setRemember] = useState(false);
  const tool = item.tool!;
  const ask = tool.ask;

  if (tool.state === "waiting" && ask != null && ask.kind === "confirm") {
    return (
      <div className="overflow-hidden rounded-lg border border-(--c-err-border)">
        <div className="flex items-center gap-1.5 bg-(--c-err-bg-soft) px-3 py-1.5 text-[12px] text-(--c-err-text)">
          <TriangleAlert className="size-3.5" />
          <span className="flex-1 font-medium">{t("agent.write.confirm")}</span>
          <span>{t("agent.write.tagIrreversible")}</span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[13px] font-medium">{nameOf(tool)}</p>
          <p className="mt-1 text-[12.5px] leading-[1.7] whitespace-pre-wrap text-(--c-fg-2)">{ask.question}</p>
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <span className="flex-1 text-[11.5px] text-muted-foreground">{t("agent.write.everyTime")}</span>
          <Button variant="outline" size="sm" onClick={() => onDecide(false, false)}>
            {t("agent.write.cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onDecide(true, false)}>
            {t(DESTROY_LABEL[tool.name] ?? "agent.write.destroy")}
          </Button>
        </div>
      </div>
    );
  }

  if (tool.state === "waiting" && ask != null) {
    const connection = tool.connection;
    return (
      <div className="overflow-hidden rounded-lg border border-(--c-warn-border)">
        <div className="flex items-center gap-1.5 bg-(--c-warn-bg-soft) px-3 py-1.5 text-[12px] text-(--c-warn-text-deep)">
          <ShieldCheck className="size-3.5" />
          <span className="flex-1 font-medium">{t("agent.write.waiting")}</span>
          <span>{t("agent.write.tagWrite")}</span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[13px] font-medium">{nameOf(tool)}</p>
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
            {connection != null && (
              <>
                <dt className="text-muted-foreground">{t("agent.write.connection")}</dt>
                <dd className="break-words">
                  {connection.name} ({familyOf(connection.family)})
                </dd>
              </>
            )}
            {fieldsOf(tool.input).map(([key, value]) => (
              <Field key={key} label={i18n.exists(`agent.field.${key}`) ? t(`agent.field.${key}`) : key}>
                {value}
              </Field>
            ))}
          </dl>
          {ask.caveat != null && ask.caveat !== "" && (
            <p className="mt-2 text-[12px] leading-[1.6] text-(--c-fg-2)">{ask.caveat}</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <label className="flex flex-1 items-center gap-1.5 text-[12px] text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={(next) => setRemember(next === true)} />
            {t("agent.write.remember")}
          </label>
          <Button variant="outline" size="sm" onClick={() => onDecide(false, false)}>
            {t("agent.write.decline")}
          </Button>
          <Button size="sm" onClick={() => onDecide(true, remember)}>
            {t("agent.write.approve")}
          </Button>
        </div>
      </div>
    );
  }

  const target = targetOf(tool);
  const approved =
    tool.approved === "session"
      ? t("agent.write.approvedSession")
      : tool.approved === "confirmed"
        ? t("agent.write.approvedConfirmed")
        : tool.approved === "once"
          ? t("agent.write.approvedOnce")
          : null;
  const failed = tool.state === "failed" || tool.state === "declined" || tool.state === "skipped";
  return (
    <Collapsible className="rounded-lg border px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-[12px]">
        <StateIcon state={tool.state} />
        <span className="flex-none font-medium">{nameOf(tool)}</span>
        {target != null && <span className="mono3 min-w-0 truncate text-muted-foreground">{target}</span>}
        <span className="flex-1" />
        {approved != null && tool.state !== "declined" && <OutlineTag>{approved}</OutlineTag>}
        {tool.state === "declined" && <OutlineTag>{t("agent.state.declined")}</OutlineTag>}
        {tool.ms != null && (
          <span className="mono3 flex-none text-[11px] text-muted-foreground">{(tool.ms / 1000).toFixed(2)}s</span>
        )}
      </CollapsibleTrigger>
      {tool.result != null && tool.result !== "" && (
        <p className={cn("mt-1 pl-5.5 text-[11.5px]", failed ? "text-(--c-err-text)" : "text-muted-foreground")}>
          {tool.result}
        </p>
      )}
      <CollapsibleContent>
        <CallDetails tool={tool} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mono3 break-words">{children}</dd>
    </>
  );
}

/**
 * Something the application says rather than the model: why a run ended
 * without an answer, and, on the last one, what can be done about it.
 */
export function Notice({
  item,
  last,
  onCarryOn,
  onStartOver,
}: {
  item: AgentItem;
  last: boolean;
  onCarryOn: () => void;
  onStartOver: () => void;
}) {
  const { t } = useTranslation();
  const notice = item.notice ?? "";
  const failed = notice === "failed";
  const message =
    notice === "limit" ? t("agent.notice.limit", { count: Number(item.text) || 0 }) : t(`agent.notice.${notice}`);
  const because =
    failed && item.reason != null && item.reason !== ""
      ? t(failureKey({ reason: item.reason, status: 0, detail: item.text ?? "" }), { detail: item.text ?? "" })
      : null;
  const detail = notice === "limit" ? null : item.text;
  const action =
    notice === "failed"
      ? { label: t("agent.notice.retry"), run: onCarryOn }
      : notice === "stopped" || notice === "limit"
        ? { label: t("agent.notice.carryOn"), run: onCarryOn }
        : notice === "context"
          ? { label: t("agent.dock.newConversation"), run: onStartOver }
          : null;
  const Icon = failed ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
        failed ? "border-(--c-err-border) bg-(--c-err-bg-soft)" : "border-dashed text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 flex-none", failed && "text-(--c-err-text)")} />
      <div className="min-w-0 flex-1">
        <p className={cn(failed && "text-(--c-err-text)")}>{message}</p>
        {because != null && <p className="mt-0.5 text-(--c-fg-2)">{because}</p>}
        {detail != null && detail !== "" && detail !== because && (
          <p className="mono3 mt-0.5 text-[11px] break-words text-muted-foreground">{detail}</p>
        )}
      </div>
      {last && action != null && (
        <Button variant="outline" size="xs" className="flex-none" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
