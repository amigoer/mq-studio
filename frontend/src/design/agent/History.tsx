import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, LoaderCircle, Lock, Pencil, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfirm, useToast } from "@/components";
import type { AgentSummary } from "@/api/agent";
import { protocolOfKind } from "@/design/data/connections";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import type { Assistant } from "@/hooks/useAssistant";
import { familyOf } from "./Blocks";
import { sectionsOf, transcriptOf } from "./sessions";
import { IconAction } from "./parts";

/**
 * The conversations kept and held, under the day each last changed: to take
 * one up again, rename it, export it or delete it.
 */
export function History({
  assistant,
  onBack,
  onClose,
  onOpenSettings,
}: {
  assistant: Assistant;
  onBack: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [needle, setNeedle] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const { sessions, settings, listSessions } = assistant;

  useEffect(() => {
    listSessions().catch((reason: unknown) =>
      toast.error(t("agent.history.failed"), { description: String(reason) }),
    );
  }, [listSessions, t, toast]);

  const sections = useMemo(() => sectionsOf(sessions ?? [], needle, new Date()), [sessions, needle]);
  const fail = (reason: unknown) =>
    toast.error(t("agent.history.failed"), {
      description: reason instanceof Error ? reason.message : String(reason),
    });

  const when = (summary: AgentSummary, day: string) => {
    const moment = new Date(summary.updated);
    return day === "earlier"
      ? moment.toLocaleDateString(i18n.language, { month: "short", day: "numeric" })
      : moment.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
  };

  const finishRename = () => {
    if (renaming == null) return;
    const { id, title } = renaming;
    setRenaming(null);
    if (title.trim() === "") return;
    assistant.rename(id, title).catch(fail);
  };

  const remove = async (summary: AgentSummary) => {
    const confirmed = await confirm({
      title: t("agent.history.deleteTitle", { title: summary.title || t("agent.dock.untitled") }),
      description: t("agent.history.deleteDesc"),
      confirmLabel: t("agent.history.delete"),
      danger: true,
    });
    if (confirmed) assistant.remove(summary.id).catch(fail);
  };

  const exportOne = (summary: AgentSummary) =>
    assistant
      .exportTranscript(summary.id, (conversation) =>
        transcriptOf(conversation, t, new Date().toLocaleString(i18n.language)),
      )
      .then((path) => {
        if (path != null) toast.success(t("agent.history.exported"), { description: path });
      })
      .catch(fail);

  const retention = settings?.retention ?? 0;

  return (
    <>
      <div className="flex h-11 flex-none items-center gap-1 border-b px-1.5">
        <IconAction label={t("agent.history.back")} onClick={onBack}>
          <ArrowLeft />
        </IconAction>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t("agent.history.title")}</span>
        <IconAction label={t("agent.dock.close")} onClick={onClose}>
          <X />
        </IconAction>
      </div>

      <div className="flex-none px-3.5 pt-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={needle}
            placeholder={t("agent.history.search")}
            aria-label={t("agent.history.search")}
            className="h-8 pl-8 text-[12.5px]"
            onChange={(event) => setNeedle(event.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2.5 pb-3">
          {sessions != null && sections.length === 0 && (
            <p className="px-2 pt-8 text-center text-[12.5px] text-muted-foreground">
              {needle.trim() === "" ? t("agent.history.empty") : t("agent.history.noMatch")}
            </p>
          )}
          {sections.map((section) => (
            <section key={section.day} className="mt-2">
              <p className="px-2 pt-1.5 pb-1 text-[11.5px] text-muted-foreground">{t(`agent.history.${section.day}`)}</p>
              {section.summaries.map((summary) => {
                const protocol = summary.connection != null ? protocolOfKind(summary.connection.family as Parameters<typeof protocolOfKind>[0]) : null;
                const title = summary.title || t("agent.dock.untitled");
                return (
                  <div key={summary.id} className="group/row relative rounded-lg hover:bg-(--c-fill)">
                    {renaming?.id === summary.id ? (
                      <div className="px-1.5 py-1.5">
                        <Input
                          autoFocus
                          value={renaming.title}
                          aria-label={t("agent.history.rename")}
                          className="h-8 text-[13px]"
                          onChange={(event) => setRenaming({ id: summary.id, title: event.target.value })}
                          onBlur={finishRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.nativeEvent.isComposing) finishRename();
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full min-w-0 px-2.5 py-2 text-left"
                        onClick={() => assistant.open(summary).then(onBack).catch(fail)}
                      >
                        <p className="flex items-center gap-1.5 truncate pr-20 text-[13px]">
                          {summary.running && <LoaderCircle className="size-3 flex-none animate-spin text-muted-foreground" />}
                          <span className="truncate">{title}</span>
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                          {protocol != null && <ProtocolIcon protocol={protocol} size={11} />}
                          {summary.connection != null && (
                            <span className="truncate">
                              {summary.connection.name} · {familyOf(summary.connection.family)} ·
                            </span>
                          )}
                          <span className="flex-none">{when(summary, section.day)}</span>
                        </p>
                      </button>
                    )}
                    {renaming?.id !== summary.id && (
                      <div className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 gap-0.5 group-focus-within/row:flex group-hover/row:flex">
                        <IconAction
                          label={t("agent.history.rename")}
                          onClick={() => setRenaming({ id: summary.id, title: summary.title })}
                        >
                          <Pencil />
                        </IconAction>
                        <IconAction label={t("agent.history.export")} onClick={() => void exportOne(summary)}>
                          <Download />
                        </IconAction>
                        <IconAction
                          label={t("agent.history.delete")}
                          disabled={summary.running}
                          onClick={() => void remove(summary)}
                        >
                          <Trash2 />
                        </IconAction>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-none items-center gap-1.5 border-t px-3.5 py-2 text-[11.5px] text-muted-foreground">
        <Lock className="size-3.5 flex-none" />
        <span className="min-w-0 flex-1 truncate">
          {retention > 0 ? t("agent.history.kept", { days: retention }) : t("agent.history.notKept")}
        </span>
        <Button variant="link" size="xs" className="h-auto px-0 text-[11.5px]" onClick={onOpenSettings}>
          {t("agent.history.settings")}
        </Button>
      </div>
    </>
  );
}
