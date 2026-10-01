import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis, FolderOpen, Plus, Server, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Panel, SettingRow, useConfirm, useToast } from "@/components";
import { revealDataDirectory } from "@/api/platform";
import { clearConversations, type AgentProviderView } from "@/api/agent";
import { useAgentSettings } from "@/hooks/useAgentSettings";
import { formatErrorMessage } from "@/lib/utils";
import { draftOf, hostOf, type ProviderDraft } from "./assistantForm";
import { Dropdown, Group } from "./parts";
import { ProviderDialog } from "./ProviderDialog";

type Dialog = { editing: ProviderDraft | null } | null;

/**
 * The assistant section: the model services the window's assistant runs on,
 * what a new conversation starts with, and what it may send and do.
 *
 * Everything but a provider saves as it changes, like the rest of the page. A
 * provider is a form of its own, with a key to try before keeping it.
 */
export function AssistantPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { view, error, saveProvider, deleteProvider, savePreferences } = useAgentSettings();
  const [dialog, setDialog] = useState<Dialog>(null);

  if (error != null) {
    return <p className="text-xs text-(--c-err)">{t("page.settings.assistant.loadFailed", { error })}</p>;
  }
  if (view == null) return null;

  const providers = view.providers ?? [];
  // Go starts a conversation on the first service when none is chosen, so the
  // page says the same rather than showing nothing chosen.
  const effective = view.default !== "" ? view.default : (providers[0]?.id ?? "");
  const preferences = {
    default: view.default,
    effort: view.effort,
    writes: view.writes,
    bodyBytes: view.bodyBytes,
    retention: view.retention,
  };
  const prefer = (change: Partial<typeof preferences>) =>
    void savePreferences({ ...preferences, ...change }).catch((reason: unknown) =>
      toast.error(t("page.settings.assistant.saveFailed"), { description: formatErrorMessage(reason) }),
    );

  const remove = async (provider: AgentProviderView) => {
    const confirmed = await confirm({
      title: t("page.settings.assistant.deleteTitle", { name: provider.name }),
      description: t("page.settings.assistant.deleteDesc"),
      confirmLabel: t("page.settings.assistant.delete"),
      danger: true,
    });
    if (!confirmed) return;
    deleteProvider(provider.id).catch((reason: unknown) =>
      toast.error(t("page.settings.assistant.saveFailed"), { description: formatErrorMessage(reason) }),
    );
  };

  const clear = async () => {
    const confirmed = await confirm({
      title: t("page.settings.assistant.clearTitle"),
      description: t("page.settings.assistant.clearDesc"),
      confirmLabel: t("page.settings.assistant.clearConfirm"),
      danger: true,
    });
    if (!confirmed) return;
    clearConversations()
      .then(() => toast.success(t("page.settings.assistant.cleared")))
      .catch((reason: unknown) =>
        toast.error(t("page.settings.assistant.clearFailed"), { description: formatErrorMessage(reason) }),
      );
  };

  const reveal = () =>
    void revealDataDirectory().catch((reason: unknown) =>
      toast.error(t("page.settings.data.openFailed"), { description: String(reason) }),
    );

  return (
    <>
      <Group
        title={t("page.settings.assistant.services")}
        first
        action={
          providers.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setDialog({ editing: null })}>
              <Plus aria-hidden />
              {t("page.settings.assistant.addService")}
            </Button>
          )
        }
      >
        <Panel>
          {providers.length === 0 ? (
            <SettingRow
              label={t("page.settings.assistant.emptyTitle")}
              hint={t("page.settings.assistant.emptyHint")}
              last
            >
              <Button variant="outline" onClick={() => setDialog({ editing: null })}>
                <Plus aria-hidden />
                {t("page.settings.assistant.addService")}
              </Button>
            </SettingRow>
          ) : (
            providers.map((provider, index) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                isDefault={provider.id === effective}
                last={index === providers.length - 1}
                onEdit={() => setDialog({ editing: draftOf(provider) })}
                onDefault={() => prefer({ default: provider.id })}
                onDelete={() => void remove(provider)}
              />
            ))
          )}
        </Panel>
      </Group>

      <Group title={t("page.settings.assistant.defaults")}>
        <Panel>
          <SettingRow label={t("page.settings.assistant.model")} hint={t("page.settings.assistant.modelHint")}>
            {providers.length > 0 ? (
              <Dropdown
                value={effective}
                width={240}
                options={providers.map((provider) => ({
                  value: provider.id,
                  label: `${provider.name} · ${provider.model}`,
                }))}
                onChange={(next) => prefer({ default: next })}
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t("page.settings.assistant.noService")}</span>
            )}
            <Dropdown
              value={view.effort}
              width={120}
              options={(["low", "medium", "high"] as const).map((effort) => ({
                value: effort,
                label: t(`page.settings.assistant.effort.${effort}`),
              }))}
              onChange={(next) => prefer({ effort: next })}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.assistant.writes")} hint={t("page.settings.assistant.writesHint")} last>
            <Dropdown
              value={view.writes}
              options={[
                { value: "approve", label: t("page.settings.assistant.writesApprove") },
                { value: "readonly", label: t("page.settings.assistant.writesReadOnly") },
              ]}
              onChange={(next) => prefer({ writes: next })}
            />
          </SettingRow>
        </Panel>
      </Group>

      <Group title={t("page.settings.assistant.privacy")}>
        <Panel>
          <SettingRow label={t("page.settings.assistant.body")} hint={t("page.settings.assistant.bodyHint")}>
            <Dropdown
              value={view.bodyBytes}
              options={(view.bodyLimits ?? []).map((limit) => ({
                value: limit,
                label:
                  limit === 0
                    ? t("page.settings.assistant.bodyNone")
                    : t("page.settings.assistant.bodyLimit", { size: `${limit / 1024} KB` }),
              }))}
              onChange={(next) => prefer({ bodyBytes: next })}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.assistant.retention")} hint={t("page.settings.assistant.retentionHint")}>
            <Dropdown
              value={view.retention}
              options={(view.retentions ?? []).map((days) => ({
                value: days,
                label:
                  days === 0
                    ? t("page.settings.assistant.retentionNone")
                    : t("page.settings.assistant.retentionDays", { days }),
              }))}
              onChange={(next) => prefer({ retention: next })}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.assistant.clear")} hint={t("page.settings.assistant.clearHint")}>
            <Button variant="outline" onClick={() => void clear()}>
              <Trash2 size={13} aria-hidden />
              {t("page.settings.assistant.clearConfirm")}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("page.settings.assistant.audit")}
            hint={
              <>
                <code className="mono3" style={{ fontSize: "var(--set-hint)" }}>
                  agent-audit.jsonl
                </code>{" "}
                {t("page.settings.assistant.auditHint")}
              </>
            }
            last
          >
            <Button variant="outline" onClick={reveal}>
              <FolderOpen size={13} aria-hidden />
              {t("page.settings.data.openDirectory")}
            </Button>
          </SettingRow>
        </Panel>
      </Group>

      {dialog != null && (
        <ProviderDialog initial={dialog.editing} onClose={() => setDialog(null)} onSave={saveProvider} />
      )}
    </>
  );
}

/** One model service: what it is, where it is reached, and what to do with it. */
function ProviderRow({
  provider,
  isDefault,
  last,
  onEdit,
  onDefault,
  onDelete,
}: {
  provider: AgentProviderView;
  isDefault: boolean;
  last: boolean;
  onEdit: () => void;
  onDefault: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const Icon = provider.kind === "anthropic" ? Sparkles : Server;
  const key = provider.apiKeyConfigured
    ? t("page.settings.assistant.keySet")
    : t("page.settings.assistant.keyNone");
  return (
    <SettingRow
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-(--c-border) bg-(--c-bar) text-(--c-fg-2)">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{provider.name}</span>
              {isDefault && (
                <Badge variant="outline" className="px-1.5 py-px text-[10px] font-normal">
                  {t("page.settings.assistant.defaultBadge")}
                </Badge>
              )}
              {provider.kind === "openai" && (
                <Badge variant="outline" className="px-1.5 py-px text-[10px] font-normal text-(--c-muted)">
                  {t("page.settings.assistant.kind.openai")}
                </Badge>
              )}
            </span>
            <span className="mt-px block truncate text-xs text-muted-foreground">
              <span className="mono3">{provider.model}</span> · {hostOf(provider)} · {key}
            </span>
          </span>
        </span>
      }
      last={last}
    >
      <Button variant="outline" onClick={onEdit}>
        {t("page.settings.assistant.edit")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("page.settings.assistant.more")}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isDefault && (
            <DropdownMenuItem onSelect={onDefault}>{t("page.settings.assistant.makeDefault")}</DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            {t("page.settings.assistant.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingRow>
  );
}
