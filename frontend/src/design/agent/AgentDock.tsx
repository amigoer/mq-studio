import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, History as HistoryIcon, Info, MessageSquare, Plus, Settings2, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components";
import { BESIDE_THE_PAGE } from "@/components/detail-panel";
import type { AgentContext } from "@/api/agent";
import type { Connection } from "@/design/data/connections";
import type { ProtocolId } from "@/design/data/protocols";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { hostOf } from "@/design/boards/settings/assistantForm";
import type { Assistant } from "@/hooks/useAssistant";
import { cn } from "@/lib/utils";
import { Answer, Notice, Reads, Thinking, UserMessage, Write } from "./Blocks";
import { blocksOf, compactCount, titleOf, tokensOf, waitingAsk } from "./conversation";
import { History } from "./History";
import { Chip, IconAction } from "./parts";
import { useSelection, type Selected } from "./selection";

/** Where the person is, as the dock shows it and a message carries it. */
export type Whereabouts = {
  connection?: { id: number; name: string; protocol: ProtocolId | null };
  page?: { id: string; label: string };
  namespace?: string;
  selected?: Selected;
};

export type Part = "connection" | "page" | "namespace" | "selected";

/** What goes with a message: everything the person did not take off. */
export function contextOf(where: Whereabouts, leftOut: ReadonlySet<Part>): AgentContext {
  const context: AgentContext = {};
  if (where.connection != null && !leftOut.has("connection")) context.connection = where.connection.id;
  if (where.page != null && !leftOut.has("page")) context.page = where.page.id;
  if (where.namespace != null && where.namespace !== "" && !leftOut.has("namespace"))
    context.namespace = where.namespace;
  if (where.selected != null && !leftOut.has("selected"))
    context.selected = { kind: where.selected.kind, name: where.selected.name };
  return context;
}

/** Enter sends and Shift+Enter breaks the line; an Enter that picks an IME candidate does neither. */
export const sends = (event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }) =>
  event.key === "Enter" && !event.shiftKey && event.isComposing !== true && event.keyCode !== 229;

/**
 * The assistant's dock: the conversation, what will go with the next
 * message, and where to type it.
 */
export function AgentDock({
  assistant,
  where,
  connections,
  pageLabel,
  onClose,
  onOpenSettings,
  focusKey,
  ask,
  onAsked,
}: {
  assistant: Assistant;
  /** Where the person is, short of what the page has selected, which the page reports here itself. */
  where: Omit<Whereabouts, "selected">;
  /** The stored connections, to name the one a sent message carried. */
  connections: readonly Connection[];
  pageLabel: (protocol: ProtocolId, page: string) => string;
  onClose: () => void;
  onOpenSettings: () => void;
  /** Changes whenever the composer should take the focus again. */
  focusKey?: unknown;
  /** A question put from elsewhere - the command palette - sent as if typed here. */
  ask?: { seq: number; text: string } | null;
  /** The question has been taken, and must not be put again. */
  onAsked?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, conversation, provider, consented, serviceGone, draft, setDraft } = assistant;
  const [view, setView] = useState<"chat" | "history">("chat");
  const selected = useSelection();
  const here: Whereabouts = selected == null ? where : { ...where, selected };
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // What the person took off goes back on once they are somewhere else.
  const whereKey = JSON.stringify(here);
  const [leftOut, setLeftOut] = useState<{ key: string; parts: Set<Part> }>({ key: whereKey, parts: new Set() });
  const parts = leftOut.key === whereKey ? leftOut.parts : new Set<Part>();
  const leaveOut = (part: Part) => setLeftOut({ key: whereKey, parts: new Set([...parts, part]) });

  const items = conversation?.items ?? [];
  const running = conversation?.running ?? false;
  const asking = waitingAsk(items);
  const blocks = useMemo(() => blocksOf(items), [items]);
  const ready = provider != null && consented;

  useEffect(() => {
    input.current?.focus();
  }, [focusKey]);

  // Follow the conversation down as it grows, unless the person scrolled up
  // to read something.
  useLayoutEffect(() => {
    if (following.current) end.current?.scrollIntoView({ block: "end" });
  }, [items]);

  const fail = (key: string) => (error: unknown) =>
    toast.error(t(key), { description: error instanceof Error ? error.message : String(error) });

  const send = (text: string) => {
    const question = text.trim();
    if (question === "" || !ready || running) return;
    following.current = true;
    setDraft("");
    assistant.send(question, contextOf(here, parts)).catch((error: unknown) => {
      setDraft(text);
      fail("agent.composer.sendFailed")(error);
    });
  };

  // Sent when it can be; otherwise left in the composer for when it can. The
  // seq keeps a remounted effect from putting the same question twice.
  const latest = useRef({ send, ready, running, setDraft, onAsked });
  latest.current = { send, ready, running, setDraft, onAsked };
  const taken = useRef<number | null>(null);
  useEffect(() => {
    if (ask == null || taken.current === ask.seq) return;
    taken.current = ask.seq;
    const { send, ready, running, setDraft, onAsked } = latest.current;
    if (ask.text !== "") {
      if (ready && !running) send(ask.text);
      else setDraft(ask.text);
    }
    onAsked?.();
  }, [ask]);

  const title = (conversation != null ? titleOf(conversation) : "") || t("agent.dock.untitled");

  const chipsOf = (context: AgentContext | null | undefined) => {
    if (context == null) return null;
    const connection = connections.find((one) => one.id === context.connection);
    const chips: ReactNode[] = [];
    if (connection != null)
      chips.push(
        <Chip key="c" icon={connection.protocol != null ? <ProtocolIcon protocol={connection.protocol} size={11} /> : null}>
          {connection.name}
        </Chip>,
      );
    if (context.page != null && connection?.protocol != null)
      chips.push(<Chip key="p">{pageLabel(connection.protocol, context.page)}</Chip>);
    if (context.selected != null) chips.push(<Chip key="s">{context.selected.name}</Chip>);
    return chips.length > 0 ? <div className="flex flex-wrap justify-end gap-1">{chips}</div> : null;
  };


  const body = (() => {
    if (settings == null) return null;
    if (settings.providers.length === 0)
      return (
        <Centered icon={<Sparkles />} title={t("agent.welcome.noServiceTitle")} hint={t("agent.welcome.noServiceHint")}>
          <Button size="sm" onClick={onOpenSettings}>
            {t("agent.welcome.openSettings")}
          </Button>
        </Centered>
      );
    if (items.length === 0) return <Welcome where={here} ready={ready} onAsk={send} />;
    return (
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {blocks.map((block, index) => {
          switch (block.kind) {
            case "user":
              return <UserMessage key={block.item.id} item={block.item} chips={chipsOf(block.item.context)} />;
            case "text":
              return <Answer key={block.item.id} item={block.item} />;
            case "thinking":
              return (
                <Thinking
                  key={block.item.id}
                  item={block.item}
                  live={running && index === blocks.length - 1}
                />
              );
            case "reads":
              return <Reads key={block.items[0]?.id} items={block.items} />;
            case "write":
              return (
                <Write
                  key={block.item.id}
                  item={block.item}
                  onDecide={(approve, remember) =>
                    void assistant
                      .decide(block.item.tool?.ask?.id ?? block.item.id, approve, remember)
                      .catch(fail("agent.composer.answerFailed"))
                  }
                />
              );
            case "notice":
              return (
                <Notice
                  key={block.item.id}
                  item={block.item}
                  last={!running && block.item === items[items.length - 1]}
                  onCarryOn={() => void assistant.carryOn().catch(fail("agent.composer.sendFailed"))}
                  onStartOver={assistant.startOver}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    );
  })();

  const placeholder = serviceGone
    ? t("agent.composer.placeholderServiceGone")
    : provider == null
      ? t("agent.composer.placeholderNoService")
      : !consented
        ? t("agent.composer.placeholderConsent")
        : asking != null
          ? t("agent.composer.placeholderWaiting")
          : t("agent.composer.placeholder");
  const usage = conversation?.usage;

  return (
    <TooltipProvider delayDuration={500}>
      <aside
        {...{ [BESIDE_THE_PAGE]: "" }}
        aria-label={t("agent.dock.label")}
        className="flex h-full w-full min-w-0 flex-col bg-background select-text"
      >
        {view === "history" ? (
          <History
            assistant={assistant}
            onBack={() => setView("chat")}
            onClose={onClose}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <>
            <div className="flex h-11 flex-none items-center gap-1 border-b pr-1.5 pl-3.5">
              <Sparkles className="size-3.5 flex-none text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate pl-1 text-[13px] font-medium">{title}</span>
              <IconAction
                label={t("agent.dock.newConversation")}
                disabled={running || items.length === 0}
                onClick={assistant.startOver}
              >
                <Plus />
              </IconAction>
              <IconAction label={t("agent.history.open")} onClick={() => setView("history")}>
                <HistoryIcon />
              </IconAction>
              <IconAction label={t("agent.dock.settings")} onClick={onOpenSettings}>
                <Settings2 />
              </IconAction>
              <IconAction label={t("agent.dock.close")} onClick={onClose}>
                <X />
              </IconAction>
            </div>

            <ScrollArea
              className="min-h-0 flex-1"
              onScrollCapture={(event) => {
                const viewport = event.target as HTMLElement;
                following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
              }}
            >
              {body}
              {settings != null && settings.providers.length > 0 && provider != null && !consented && (
                <Consent assistant={assistant} onReview={onOpenSettings} onFail={fail("agent.composer.consentFailed")} />
              )}
              <div ref={end} />
            </ScrollArea>

            <div className="flex-none p-2.5 pt-0">
              <div className="rounded-xl border bg-background shadow-xs focus-within:border-ring">
                <ContextChips where={here} parts={parts} onLeaveOut={leaveOut} />
                <Textarea
                  ref={input}
                  value={draft}
                  rows={1}
                  disabled={!ready}
                  placeholder={placeholder}
                  aria-label={t("shell.palette.ask")}
                  className="max-h-40 min-h-10 resize-none border-0 bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (!sends({ ...event, isComposing: event.nativeEvent.isComposing })) return;
                    event.preventDefault();
                    send(draft);
                  }}
                />
                <div className="flex items-center gap-2 px-2.5 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                    {provider != null && (
                      <>
                        <span className="mono3">{conversation?.model ?? provider.model}</span>
                        {settings != null && <> · {t(`page.settings.assistant.effort.${settings.effort}`)}</>}
                      </>
                    )}
                  </span>
                  {usage != null && tokensOf(usage) > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="mono3 flex-none text-[11px] text-muted-foreground">
                          {t("agent.composer.tokens", { amount: compactCount(tokensOf(usage)) })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("agent.composer.usage", {
                          input: compactCount(usage.input),
                          cache: compactCount((usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)),
                          output: compactCount(usage.output),
                        })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {running ? (
                    <Button
                      size="icon-xs"
                      aria-label={t("agent.composer.stop")}
                      onClick={() => void assistant.stop().catch(fail("agent.composer.stopFailed"))}
                    >
                      <Square className="size-2.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      size="icon-xs"
                      aria-label={t("agent.composer.send")}
                      disabled={!ready || draft.trim() === ""}
                      onClick={() => send(draft)}
                    >
                      <ArrowUp />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}

function ContextChips({
  where,
  parts,
  onLeaveOut,
}: {
  where: Whereabouts;
  parts: ReadonlySet<Part>;
  onLeaveOut: (part: Part) => void;
}) {
  const { t } = useTranslation();
  const chips: ReactNode[] = [];
  const add = (part: Part, label: string, icon?: ReactNode) => {
    if (parts.has(part)) return;
    chips.push(
      <Chip
        key={part}
        icon={icon}
        onRemove={() => onLeaveOut(part)}
        removeLabel={t("agent.composer.leaveOut", { name: label })}
      >
        {label}
      </Chip>,
    );
  };
  if (where.connection != null)
    add(
      "connection",
      where.connection.name,
      where.connection.protocol != null ? <ProtocolIcon protocol={where.connection.protocol} size={11} /> : undefined,
    );
  if (where.page != null) add("page", where.page.label);
  if (where.namespace != null && where.namespace !== "")
    add("namespace", t("agent.context.namespace", { name: where.namespace }));
  if (where.selected != null) add("selected", where.selected.name);
  return chips.length > 0 ? <div className="flex flex-wrap gap-1 px-2.5 pt-2">{chips}</div> : null;
}

function Centered({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 pt-12 pb-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border bg-(--c-panel) text-muted-foreground [&_svg]:size-4.5">
        {icon}
      </div>
      <p className="mt-3 text-[14px] font-medium">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.7] text-muted-foreground">{hint}</p>
      {children != null && <div className="mt-4">{children}</div>}
    </div>
  );
}

function Welcome({ where, ready, onAsk }: { where: Whereabouts; ready: boolean; onAsk: (text: string) => void }) {
  const { t } = useTranslation();
  const suggestions =
    where.connection != null
      ? [t("agent.welcome.suggestLag"), t("agent.welcome.suggestDead"), t("agent.welcome.suggestHealth")]
      : [t("agent.welcome.suggestConnections"), t("agent.welcome.suggestHealth")];
  return (
    <>
      <Centered
        icon={<Sparkles />}
        title={
          where.connection != null
            ? t("agent.welcome.askAbout", { name: where.connection.name })
            : t("agent.welcome.askAnything")
        }
        hint={where.connection != null ? t("agent.welcome.intro") : t("agent.welcome.introAll")}
      />
      <div className="flex flex-col gap-1.5 px-4">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            disabled={!ready}
            className="h-auto justify-start gap-2 py-2 text-left text-[12.5px] font-normal whitespace-normal"
            onClick={() => onAsk(suggestion)}
          >
            <MessageSquare className="text-muted-foreground" />
            {suggestion}
          </Button>
        ))}
      </div>
    </>
  );
}

/**
 * Nothing is sent to a model service until the person has read what goes
 * there and agreed, once per service.
 */
function Consent({
  assistant,
  onReview,
  onFail,
}: {
  assistant: Assistant;
  onReview: () => void;
  onFail: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const { provider, settings } = assistant;
  const [busy, setBusy] = useState(false);
  if (provider == null || settings == null) return null;
  const bodies =
    settings.bodyBytes === 0
      ? t("agent.consent.bodiesNone")
      : t("agent.consent.bodiesLimit", { size: `${settings.bodyBytes / 1024} KB` });
  return (
    <div className="mx-4 mt-4 mb-2 rounded-lg border bg-(--c-panel) p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Info className="size-3.5 text-muted-foreground" />
        {t("agent.consent.title")}
      </p>
      <p className={cn("mt-1.5 text-[12px] leading-[1.7] text-(--c-fg-2)")}>
        {t("agent.consent.body", { service: provider.name, host: hostOf(provider), bodies })}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onReview}>
          {t("agent.consent.review")}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            assistant
              .consent()
              .catch(onFail)
              .finally(() => setBusy(false));
          }}
        >
          {t("agent.consent.agree")}
        </Button>
      </div>
    </div>
  );
}
