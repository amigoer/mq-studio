import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Combobox,
  JsonBlock,
  KV,
  Panel,
  PanelHeader,
  SectionLabel,
  Status,
  WarnBanner,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitNamespaces } from "@/hooks/rabbitmq/useRabbitNamespaces";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import * as rabbitApi from "@/api/rabbitmq";
import type { DefinitionsPreview } from "@/api/rabbitmq";

/** How many objects a document would create, across every kind. */
function totalOf(counts: Record<string, number | undefined> | undefined): number {
  return Object.values(counts ?? {}).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

/** The kinds a document carries, in the order they matter to a reader. */
const KINDS = [
  "vhosts",
  "users",
  "permissions",
  "queues",
  "exchanges",
  "bindings",
  "policies",
  "parameters",
] as const;

/** The whole broker rather than one virtual host. */
const WHOLE_BROKER = "__broker__";

/**
 * RabbitMQ definitions.
 *
 * The only backup RabbitMQ offers of anything but message data: virtual hosts,
 * users and permissions, queues, exchanges, bindings, policies and parameters
 * in one document. It is what a cluster is rebuilt from.
 *
 * Importing is additive and destructive at once, and the page says so in both
 * halves. Anything named in the document is created or overwritten; anything
 * on the broker the document does not mention is left exactly as it is. So it
 * cannot make a cluster match a file - only put the file's contents into it,
 * over whatever was there.
 */
export function DefinitionsRabbitMQ() {
  const { t } = useTranslation();
  const namespaces = useRabbitNamespaces();
  const { id: connID, online } = useConnectionScope();
  const confirm = useConfirm();
  const [scope, setScope] = useState<string>(WHOLE_BROKER);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<DefinitionsPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vhost = scope === WHOLE_BROKER ? "" : scope;
  const vhostNames = useMemo(
    () => (namespaces.data ?? []).map((namespace) => namespace.name),
    [namespaces.data],
  );

  const exportToFile = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const path = await rabbitApi.exportDefinitionsToFile(connID, vhost);
      // Empty means the save dialog was dismissed, which is not a failure.
      if (path !== "") {
        toast.success(t("board.definitions.rabbitmq.exported", { path }));
      }
    } catch (exportError) {
      setError(formatErrorMessage(exportError));
    } finally {
      setExporting(false);
    }
  }, [connID, t, vhost]);

  const choose = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    try {
      const chosen = await rabbitApi.readDefinitionsFile();
      setPreview(chosen != null && chosen.path !== "" ? chosen : null);
    } catch (readError) {
      setError(formatErrorMessage(readError));
    } finally {
      setPreviewing(false);
    }
  }, []);

  const apply = useCallback(async () => {
    if (preview == null) return;
    const total = totalOf(preview.counts);
    const ok = await confirm({
      title: t("board.definitions.rabbitmq.importTitle", {
        scope: vhost === "" ? t("board.definitions.rabbitmq.wholeBroker") : vhost,
      }),
      description: t("board.definitions.rabbitmq.importDesc", { count: total }),
      confirmLabel: t("board.definitions.rabbitmq.import"),
      danger: true,
    });
    if (!ok) return;

    setImporting(true);
    setError(null);
    try {
      await rabbitApi.importDefinitions(connID, vhost, preview.document);
      toast.success(t("board.definitions.rabbitmq.imported"));
      setPreview(null);
    } catch (importError) {
      setError(formatErrorMessage(importError));
    } finally {
      setImporting(false);
    }
  }, [confirm, connID, preview, t, vhost]);

  return (
    <Page>
      <PageHeader
        title={t("board.definitions.rabbitmq.title")}
        subtitle={t("board.definitions.rabbitmq.subtitle")}
      />
      <PageBody>
        <BoardState state={{ loading: false, error: null, online, refresh: async () => {} }}>
          <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <PanelHeader title={t("board.definitions.rabbitmq.scope")} />
            <Combobox
              value={scope}
              onValueChange={setScope}
              options={[
                { value: WHOLE_BROKER, label: t("board.definitions.rabbitmq.wholeBroker") },
                ...vhostNames.map((name) => ({ value: name })),
              ]}
              className="w-[280px]"
            />
            <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {/* A whole-broker export carries every user's password hash. A
                  per-vhost one carries none, which is what makes it the right
                  thing to move between environments. */}
              {t(
                vhost === ""
                  ? "board.definitions.rabbitmq.brokerScopeHint"
                  : "board.definitions.rabbitmq.vhostScopeHint",
              )}
            </span>
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <PanelHeader title={t("board.definitions.rabbitmq.export")} />
              <span style={{ fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
                {t("board.definitions.rabbitmq.exportHint")}
              </span>
              <div>
                <Button disabled={!online || exporting} onClick={() => void exportToFile()}>
                  {exporting ? <Spinner /> : <Download size={13} aria-hidden />}
                  {t("board.definitions.rabbitmq.exportAction")}
                </Button>
              </div>
            </Panel>

            <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <PanelHeader title={t("board.definitions.rabbitmq.import")} />
              <span style={{ fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
                {t("board.definitions.rabbitmq.importHint")}
              </span>
              <div>
                <Button
                  variant="outline"
                  disabled={!online || previewing}
                  onClick={() => void choose()}
                >
                  {previewing ? <Spinner /> : <Upload size={13} aria-hidden />}
                  {t("board.definitions.rabbitmq.chooseFile")}
                </Button>
              </div>
            </Panel>
          </div>

          {/* The document is opaque, so what it will create is the only review
              anyone can perform before it lands on a cluster. */}
          {preview != null && (
            <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <PanelHeader title={t("board.definitions.rabbitmq.preview")} />
              <WarnBanner>{t("board.definitions.rabbitmq.additiveWarn")}</WarnBanner>
              <KV rows={[[t("board.definitions.rabbitmq.file"), preview.path]]} />
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>
                  {t("board.definitions.rabbitmq.contains")}
                </SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {KINDS.map((kind) => {
                    const count = preview.counts?.[kind] ?? 0;
                    if (count === 0) return null;
                    return (
                      <Status key={kind} tone={kind === "users" ? "warn" : "off"}>
                        {t(`board.definitions.rabbitmq.kinds.${kind}`)} {formatCount(count)}
                      </Status>
                    );
                  })}
                  {totalOf(preview.counts) === 0 && (
                    <span style={{ fontSize: "11.5px", color: "var(--c-err-text)" }}>
                      {t("board.definitions.rabbitmq.empty")}
                    </span>
                  )}
                </div>
              </div>
              <details>
                <summary style={{ fontSize: "11.5px", cursor: "pointer", color: "var(--c-fg-2)" }}>
                  {t("board.definitions.rabbitmq.showDocument")}
                </summary>
                <div style={{ marginTop: "8px" }}>
                  <JsonBlock>{preview.document}</JsonBlock>
                </div>
              </details>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <Button variant="destructive" disabled={importing} onClick={() => void apply()}>
                  {importing && <Spinner />}
                  {t("board.definitions.rabbitmq.applyAction")}
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </Panel>
          )}

          {error != null && (
            <Panel style={{ padding: "10px 14px", fontSize: "11.5px", color: "var(--c-err-text)" }}>
              {error}
            </Panel>
          )}
        </BoardState>
      </PageBody>
    </Page>
  );
}
