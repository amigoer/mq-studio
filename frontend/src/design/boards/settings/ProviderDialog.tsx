import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle, RefreshCw, Server, Sparkles, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components";
import { Combobox } from "@/components/combobox";
import {
  listAgentModels,
  testAgentProvider,
  type AgentFailure,
  type AgentModel,
  type AgentProviderInput,
} from "@/api/agent";
import { cn, formatErrorMessage } from "@/lib/utils";
import { Advanced, Fld, HINT, MONO, ROWS, SWITCH_ROW } from "../connections/ConnectionForms";
import {
  DEFAULT_BASE_URL,
  emptyDraft,
  failureKey,
  hasKey,
  inputOf,
  unsavable,
  untestable,
  type ProviderDraft,
  type ProviderKind,
} from "./assistantForm";

type Verdict = { kind: "ok"; seconds: string } | { kind: "failed"; failure: AgentFailure };

/**
 * Adds a model service, or edits one: the connection dialog's shape, for a
 * service the assistant runs on rather than a broker.
 *
 * A test and a model listing run on the form as it stands, before anything is
 * saved, so a key can be tried before it is kept. The key itself only ever
 * goes one way: typed here and sent to Go, which never sends it back.
 */
export function ProviderDialog({
  initial,
  onClose,
  onSave,
}: {
  /** The service being edited, or null to add one. */
  initial: ProviderDraft | null;
  onClose: () => void;
  onSave: (input: AgentProviderInput) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const editing = initial != null;
  const [draft, setDraft] = useState<ProviderDraft>(
    () => initial ?? emptyDraft("anthropic", t("page.settings.assistant.kind.anthropic")),
  );
  const [models, setModels] = useState<AgentModel[]>([]);
  const [listing, setListing] = useState(false);
  const [listFailure, setListFailure] = useState<AgentFailure | null>(null);
  const [probing, setProbing] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Open on a service that already sets one of these, so editing never hides
  // a value it is actually using.
  const [advancedOpen, setAdvancedOpen] = useState(
    initial != null && (initial.proxy !== "" || (initial.kind === "anthropic" && !initial.fallback)),
  );

  const set = <K extends keyof ProviderDraft>(key: K, next: ProviderDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: next }));
    // A verdict is about the form it was reached on.
    setVerdict(null);
    setSaveError(null);
  };

  const switchKind = (kind: ProviderKind) => {
    const fresh = emptyDraft(kind, t(`page.settings.assistant.kind.${kind}`));
    // A name the person typed survives the switch; the other kind's default does not.
    const named = draft.name !== t(`page.settings.assistant.kind.${draft.kind}`);
    setDraft({ ...fresh, name: named ? draft.name : fresh.name, apiKey: draft.apiKey });
    setModels([]);
    setListFailure(null);
    setVerdict(null);
  };

  const testBlocked = untestable(draft);
  const saveBlocked = unsavable(draft);
  const stored = draft.keyStored && !draft.clearKey;

  const runTest = () => {
    setProbing(true);
    setVerdict(null);
    testAgentProvider(inputOf(draft))
      .then((probe) => {
        setVerdict(
          probe.ok
            ? { kind: "ok", seconds: (probe.elapsedMs / 1000).toFixed(1) }
            : { kind: "failed", failure: probe.failure ?? { reason: "other", status: 0, detail: "" } },
        );
      })
      .catch((error: unknown) =>
        setVerdict({ kind: "failed", failure: { reason: "other", status: 0, detail: formatErrorMessage(error) } }),
      )
      .finally(() => setProbing(false));
  };

  const fetchModels = () => {
    setListing(true);
    setListFailure(null);
    listAgentModels(inputOf(draft))
      .then((listed) => {
        setModels(listed.models ?? []);
        setListFailure(listed.failure ?? null);
      })
      .catch((error: unknown) =>
        setListFailure({ reason: "other", status: 0, detail: formatErrorMessage(error) }),
      )
      .finally(() => setListing(false));
  };

  const save = () => {
    setSaving(true);
    setSaveError(null);
    onSave(inputOf(draft))
      .then(onClose)
      .catch((error: unknown) => setSaveError(formatErrorMessage(error)))
      .finally(() => setSaving(false));
  };

  // The id is what gets sent, so it is the part set like the other addresses
  // here; a service's own name for the model rides beside it.
  const modelLabel = (id: string, name?: string) => (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="mono3 truncate" style={MONO}>
        {id}
      </span>
      {name ? <span className="truncate text-xs text-muted-foreground">{name}</span> : null}
    </span>
  );
  const modelOptions = [
    ...(draft.model !== "" && !models.some((model) => model.id === draft.model)
      ? [{ value: draft.model, label: modelLabel(draft.model) }]
      : []),
    ...models.map((model) => ({ value: model.id, label: modelLabel(model.id, model.name) })),
  ];
  const KindIcon = draft.kind === "anthropic" ? Sparkles : Server;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-(--c-border) py-4 pr-12 pl-6 text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-(--c-border) bg-(--c-bar) text-(--c-fg-2)">
            <KindIcon className="size-[18px]" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="truncate">
                {editing
                  ? t("page.settings.assistant.form.titleEdit", { name: initial.name })
                  : t("page.settings.assistant.form.titleAdd")}
              </DialogTitle>
              {editing && (
                <Badge variant="outline" className="px-1.5 py-px text-[10px] font-normal text-(--c-muted)">
                  {t(`page.settings.assistant.kind.${draft.kind}`)}
                </Badge>
              )}
            </div>
            <DialogDescription className="text-xs leading-snug text-pretty">
              {t("page.settings.assistant.form.description")}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 py-5">
          <div className={ROWS}>
            {/* A service keeps its protocol once saved: a key one service
                issued means nothing to the other. */}
            {!editing && (
              <Fld label={t("page.settings.assistant.form.kind")}>
                <Segmented
                  block
                  tone="soft"
                  value={draft.kind}
                  onChange={(next: ProviderKind) => switchKind(next)}
                  options={[
                    { value: "anthropic", label: t("page.settings.assistant.kind.anthropic") },
                    { value: "openai", label: t("page.settings.assistant.kind.openai") },
                  ]}
                />
              </Fld>
            )}
            <Fld label={t("page.settings.assistant.form.name")}>
              <Input value={draft.name} onChange={(event) => set("name", event.target.value)} />
            </Fld>
            <Fld
              label="API Key"
              hint={
                stored ? (
                  <button type="button" className="mqs-linkbtn" onClick={() => set("clearKey", true)}>
                    {t("page.settings.assistant.form.clearKey")}
                  </button>
                ) : draft.kind === "anthropic" ? (
                  t("page.settings.assistant.form.apiKeyHint")
                ) : (
                  t("page.settings.assistant.form.apiKeyOptional")
                )
              }
            >
              <Input
                type="password"
                autoComplete="off"
                className="mono3"
                style={MONO}
                value={draft.apiKey}
                placeholder={stored ? t("page.settings.assistant.form.apiKeyStored") : undefined}
                onChange={(event) => set("apiKey", event.target.value)}
              />
            </Fld>
            <Fld
              label="Base URL"
              hint={t(`page.settings.assistant.form.baseURLHint.${draft.kind}`)}
            >
              <Input
                className="mono3"
                style={MONO}
                value={draft.baseURL}
                placeholder={DEFAULT_BASE_URL[draft.kind]}
                onChange={(event) => set("baseURL", event.target.value)}
              />
            </Fld>
            <Fld
              label={t("page.settings.assistant.form.model")}
              hint={
                listFailure != null ? (
                  <span className="text-(--c-err-text)">
                    {t(failureKey(listFailure), { detail: listFailure.detail })}
                    {listFailure.detail !== "" && failureKey(listFailure) !== "page.settings.assistant.failure.other"
                      ? ` · ${listFailure.detail}`
                      : ""}
                  </span>
                ) : models.length > 0 ? (
                  t("page.settings.assistant.form.modelsListed", { count: models.length })
                ) : (
                  t("page.settings.assistant.form.modelHint")
                )
              }
            >
              <div className="flex min-w-0 items-center gap-2">
                <Combobox
                  value={draft.model}
                  onValueChange={(next) => set("model", next)}
                  options={modelOptions}
                  placeholder={t("page.settings.assistant.form.modelPlaceholder")}
                  searchPlaceholder={t("page.settings.assistant.form.modelSearch")}
                  emptyText={t("page.settings.assistant.form.modelNone")}
                  customText={(typed) => t("page.settings.assistant.form.modelUse", { model: typed })}
                  className="h-9 min-w-0 flex-1"
                />
                <Button
                  variant="outline"
                  disabled={listing || (draft.kind === "anthropic" && !hasKey(draft))}
                  aria-busy={listing || undefined}
                  onClick={fetchModels}
                >
                  {listing ? <Spinner /> : <RefreshCw aria-hidden />}
                  {t("page.settings.assistant.form.fetchModels")}
                </Button>
              </div>
            </Fld>
          </div>
          <Advanced
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((open) => !open)}
            label={t(`page.settings.assistant.form.advanced.${draft.kind}`)}
          />
          {advancedOpen && (
            <div className={ROWS}>
              <Fld label={t("page.settings.assistant.form.proxy")} hint={t("page.settings.assistant.form.proxyHint")}>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.proxy}
                  placeholder="http://127.0.0.1:7890"
                  onChange={(event) => set("proxy", event.target.value)}
                />
              </Fld>
              {draft.kind === "anthropic" && (
                <Fld label={t("page.settings.assistant.form.fallback")}>
                  <div style={SWITCH_ROW}>
                    <Switch checked={draft.fallback} onCheckedChange={(next) => set("fallback", next)} />
                    <span className={HINT}>{t("page.settings.assistant.form.fallbackHint")}</span>
                  </div>
                </Fld>
              )}
            </div>
          )}
        </div>

        <div className="rounded-b-[calc(var(--radius-lg)-1px)] border-t border-(--c-border) bg-(--c-bar) px-6 py-3.5">
          {verdict?.kind === "failed" && (
            <div className="mqs-probe-reveal">
              <div>
                <Alert className="mb-3.5 border-transparent bg-(--c-err-bg) px-3 py-2">
                  <AlertDescription className="text-xs text-(--c-err-text) [overflow-wrap:anywhere]">
                    {t(failureKey(verdict.failure), { detail: verdict.failure.detail })}
                    {verdict.failure.detail !== "" &&
                    failureKey(verdict.failure) !== "page.settings.assistant.failure.other"
                      ? ` · ${verdict.failure.detail}`
                      : ""}
                    {verdict.failure.reason === "rejected" && draft.kind === "anthropic" && draft.fallback
                      ? ` ${t("page.settings.assistant.failure.rejectedFallback")}`
                      : ""}
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}
          <DialogFooter className="items-center gap-3 sm:justify-between">
            <div className="flex shrink-0 items-center">
              <Button
                variant="outline"
                disabled={testBlocked != null}
                aria-busy={probing || undefined}
                className="active:scale-[0.97] aria-busy:cursor-progress"
                onClick={runTest}
              >
                {t("page.settings.assistant.form.test")}
              </Button>
              <span role="status" className="inline-flex items-center whitespace-nowrap *:ml-2">
                {probing ? (
                  <span className="mqs-probe-in inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <LoaderCircle className="mqs-turning size-3.5" aria-hidden />
                    {t("page.settings.assistant.form.testing")}
                  </span>
                ) : verdict?.kind === "ok" ? (
                  <span className="mqs-probe-in inline-flex h-6 items-center gap-1.5 rounded-full bg-(--c-ok-tint) px-2.5 text-xs font-medium text-(--c-ok-text)">
                    <Check className="mqs-probe-mark size-3.5" strokeWidth={2.5} aria-hidden />
                    {t("page.settings.assistant.form.testOk", { seconds: verdict.seconds })}
                  </span>
                ) : verdict?.kind === "failed" ? (
                  <span className="mqs-probe-in inline-flex h-6 items-center gap-1.5 rounded-full bg-(--c-err-bg) px-2.5 text-xs font-medium text-(--c-err-text)">
                    <X className="mqs-probe-mark size-3.5" strokeWidth={2.5} aria-hidden />
                    {t("page.settings.assistant.form.testFailed")}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {(saveError ?? saveBlocked) != null && (
                <span
                  className={cn(
                    "max-w-72 min-w-0 text-right text-xs text-balance",
                    saveError != null ? "text-(--c-err)" : "text-muted-foreground",
                  )}
                >
                  {saveError ?? t(saveBlocked ?? "")}
                </span>
              )}
              <Button variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button disabled={saveBlocked != null || saving} onClick={save}>
                {saving && <Spinner />}
                {t("page.settings.assistant.form.save")}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
