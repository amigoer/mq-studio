import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  KV,
  Panel,
  SectionLabel,
  toast,
  useConfirm,
} from "@/components";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { usePulsarNamespaces, usePulsarTenants } from "@/hooks/pulsar/usePulsarNamespaces";
import * as pulsarApi from "@/api/pulsar";
import { limitCount, shortNameOf, tenantOf } from "@/mq/pulsar/namespaces";
import { formatErrorMessage } from "@/lib/utils";
import { NamespaceDialogPulsar } from "./NamespaceDialogPulsar";
import { NamespaceLimitsPulsar } from "./NamespaceLimitsPulsar";

/**
 * Board 12b — Pulsar tenants and namespaces.
 *
 * Pulsar addresses a topic as tenant/namespace/name, so this is not an
 * optional organising page the way a RabbitMQ vhost list is - it is where the
 * topics page's scope comes from. It reuses the vhosts slot because the slot's
 * model is literally model.Namespace, and the label is per-protocol so nothing
 * shared has to learn the word "tenant".
 *
 * The two halves are read separately on purpose. Listing tenants needs a
 * cluster superuser and a scoped credential gets a 403; folding them into one
 * request would make this page fail entirely for a connection that can read
 * its own namespaces perfectly well.
 */
export function NamespacesPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const state = usePulsarNamespaces();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const namespaces = state.data ?? [];
  const namespace = namespaces.find((candidate) => candidate.name === selected) ?? null;
  const tenants = usePulsarTenants(state.online);

  // The connection's own tenant, which is what a create goes under. Taken from
  // a listed namespace rather than guessed, so the dialog names the one the
  // driver will actually use.
  const scopeTenant = namespaces.length > 0 ? tenantOf(namespaces[0]!) : "";

  const create = async (name: string) => {
    await pulsarApi.createPulsarNamespace(connID, name);
    await state.refresh();
    toast.success(t("board.vhosts.pulsar.created", { name }));
  };

  const remove = async (name: string) => {
    const ok = await confirm({
      title: t("board.vhosts.pulsar.deleteTitle"),
      description: t("board.vhosts.pulsar.deleteBody", { name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await pulsarApi.removePulsarNamespace(connID, name);
      setSelected(null);
      await state.refresh();
      toast.success(t("board.vhosts.pulsar.deleted", { name }));
    } catch (failure) {
      // Pulsar refuses while the namespace still holds topics, and that is the
      // message worth showing: it names the thing the operator has to deal
      // with before the delete can succeed.
      toast.error(formatErrorMessage(failure));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.vhosts.pulsar.title")}
        subtitle={scopeTenant}
        actions={
          <>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!state.online}>
              <Plus size={14} aria-hidden />
              {t("board.vhosts.pulsar.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </>
        }
      />
      <BoardState state={state}>
        <ListArea>
          <ListPane>
            <Panel>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.vhosts.pulsar.namespace")}</TableHead>
                    <TableHead>{t("board.vhosts.pulsar.tenant")}</TableHead>
                    <TableHead className="text-right">
                      {t("board.vhosts.pulsar.limitsSet")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {namespaces.map((row) => (
                    <TableRow
                      key={row.name}
                      data-state={row.name === selected ? "selected" : undefined}
                      onClick={() => setSelected(row.name)}
                    >
                      <TableCell className="mono3">{shortNameOf(row)}</TableCell>
                      <TableCell className="mono3">{tenantOf(row)}</TableCell>
                      <TableCell className="text-right">{limitCount(row)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>

            {tenants.data != null && tenants.data.length > 0 && (
              <Panel>
                <Toolbar>
                  <SectionLabel>{t("board.vhosts.pulsar.tenants")}</SectionLabel>
                </Toolbar>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("board.vhosts.pulsar.tenant")}</TableHead>
                      <TableHead>{t("board.vhosts.pulsar.adminRoles")}</TableHead>
                      <TableHead>{t("board.vhosts.pulsar.allowedClusters")}</TableHead>
                      <TableHead className="text-right">
                        {t("board.vhosts.pulsar.namespaceCount")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenants.data.map((tenant) => (
                      <TableRow key={tenant.name}>
                        <TableCell className="mono3">{tenant.name}</TableCell>
                        <TableCell className="mono3">
                          {(tenant.adminRoles ?? []).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="mono3">
                          {(tenant.allowedClusters ?? []).join(", ") || "—"}
                        </TableCell>
                        {/* -1 is "this credential could not list them", which
                            is a fact about the connection and not about the
                            tenant. It must not render as zero namespaces. */}
                        <TableCell className="text-right">
                          {tenant.namespaces < 0 ? "—" : tenant.namespaces}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            )}
          </ListPane>

          {namespace != null && (
            <DetailPanel>
              <DetailPanelHeader
                title={shortNameOf(namespace)}
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <KV
                  rows={[
                    [t("board.vhosts.pulsar.tenant"), <span className="mono3">{tenantOf(namespace)}</span>],
                    [t("board.vhosts.pulsar.fullName"), <span className="mono3">{namespace.name}</span>],
                  ]}
                />
                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void remove(namespace.name)}
                  >
                    <Trash2 size={13} aria-hidden />
                    {t("board.common.delete")}
                  </Button>
                </div>
                <NamespaceLimitsPulsar
                  namespace={namespace}
                  onSet={async (key, value) => {
                    await pulsarApi.setPulsarNamespaceLimit(connID, namespace.name, key, value);
                    await state.refresh();
                  }}
                  onRemove={async (key) => {
                    await pulsarApi.removePulsarNamespaceLimit(connID, namespace.name, key);
                    await state.refresh();
                  }}
                />
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>

      <NamespaceDialogPulsar
        open={creating}
        tenant={scopeTenant}
        onClose={() => setCreating(false)}
        onSubmit={create}
      />
    </Page>
  );
}
