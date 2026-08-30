import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plug, Plus, RefreshCw, Settings, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { PROTOCOLS, type PageId, type ProtocolId } from "@/design/data/protocols";
import { useCapabilities } from "@/mq/capabilities";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { navAvailability } from "@/mq/navigation";
import type { Connection } from "@/design/data/connections";

/**
 * Board 9d — ⌘K across every connection.
 *
 * The canvas draws Topic and 消费者组 hits alongside the connections; those need
 * the MQ data plane, so what is here is what the shell itself knows: the
 * connections, the pages of the tab in front, and the window's own commands.
 * The drawn sections slot back in beside them once the boards are wired.
 *
 * Filtering stays in this component (the matcher spans name, address and
 * protocol label), so the Command runs with its own filter off and the list
 * simply renders what matched.
 */

type Hit = {
  key: string;
  group: string;
  name: string;
  meta: string;
  icon?: LucideIcon;
  protocol?: ProtocolId;
  run: () => void;
};

export function CommandPalette({
  open,
  query,
  connections,
  protocol,
  onQueryChange,
  onOpenConnection,
  onOpenPage,
  onNewConnection,
  onOpenSettings,
  onCheckUpdate,
  onClose,
}: {
  open: boolean;
  query: string;
  connections: readonly Connection[];
  /** The protocol of the tab in front, whose pages are reachable from here. */
  protocol: ProtocolId | null;
  onQueryChange?: (q: string) => void;
  onOpenConnection?: (key: string) => void;
  onOpenPage?: (page: PageId) => void;
  onNewConnection?: () => void;
  onOpenSettings?: () => void;
  onCheckUpdate?: () => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const { online } = useConnectionScope();
  // The palette navigates the same pages the sidebar does, so it has to agree
  // with it about which ones exist here.
  const nav = useMemo(() => navAvailability(capabilities, online), [capabilities, online]);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (...fields: string[]) =>
      needle === "" || fields.some((field) => field.toLowerCase().includes(needle));

    const out: Hit[] = [];
    for (const connection of connections) {
      // The row's action is to open a tab, which a family with no boards has
      // nothing to open; it stays findable on the connection list.
      if (connection.protocol == null) continue;
      if (!matches(connection.name, connection.address, connection.protocolLabel)) continue;
      out.push({
        key: `connection:${connection.key}`,
        group: t("shell.palette.connections"),
        name: connection.name,
        meta: `${connection.protocolLabel} · ${connection.address}`,
        protocol: connection.protocol,
        run: () => onOpenConnection?.(connection.key),
      });
    }
    if (protocol != null) {
      for (const group of PROTOCOLS[protocol].nav) {
        for (const entry of group.items) {
          if (!nav.visible(entry.id) || nav.disabled(entry.id)) continue;
          const label = t(entry.label);
          if (!matches(label, entry.id)) continue;
          out.push({
            key: `page:${entry.id}`,
            group: t("shell.palette.pages"),
            name: label,
            meta: group.label != null ? t(group.label) : t("shell.palette.navigation"),
            icon: entry.icon,
            run: () => onOpenPage?.(entry.id),
          });
        }
      }
    }
    const commands: readonly { key: string; name: string; icon: LucideIcon; run?: () => void }[] = [
      { key: "newConnection", name: t("shell.palette.newConnection"), icon: Plus, run: onNewConnection },
      { key: "openSettings", name: t("shell.palette.openSettings"), icon: Settings, run: onOpenSettings },
      { key: "checkUpdate", name: t("shell.palette.checkUpdate"), icon: RefreshCw, run: onCheckUpdate },
    ];
    for (const command of commands) {
      if (!matches(command.name)) continue;
      out.push({
        key: `command:${command.key}`,
        group: t("shell.palette.commands"),
        name: command.name,
        meta: t("shell.palette.window"),
        icon: command.icon,
        run: () => command.run?.(),
      });
    }
    return out;
  }, [
    connections,
    nav,
    onCheckUpdate,
    onNewConnection,
    onOpenConnection,
    onOpenPage,
    onOpenSettings,
    protocol,
    query,
    t,
  ]);

  /* Insertion order is the section order the canvas draws. */
  const groups = useMemo(() => {
    const names: string[] = [];
    const byName = new Map<string, Hit[]>();
    for (const hit of hits) {
      const bucket = byName.get(hit.group);
      if (bucket == null) {
        names.push(hit.group);
        byName.set(hit.group, [hit]);
      } else {
        bucket.push(hit);
      }
    }
    return names.map((name) => ({ name, items: byName.get(name)! }));
  }, [hits]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
    >
      <DialogContent
        className="top-24 translate-y-0 overflow-hidden p-0 sm:max-w-[560px]"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("shell.palette.label")}</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={(next) => onQueryChange?.(next)}
            placeholder={t("shell.palette.placeholder")}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>{t("shell.palette.empty")}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.items.map((hit) => (
                  <CommandItem
                    key={hit.key}
                    value={hit.key}
                    onSelect={() => {
                      hit.run();
                      onClose?.();
                    }}
                  >
                    {hit.protocol != null ? (
                      <ProtocolIcon protocol={hit.protocol} size={15} />
                    ) : hit.icon != null ? (
                      <hit.icon aria-hidden />
                    ) : (
                      <Plug aria-hidden />
                    )}
                    <span className="mono3 text-sm">{hit.name}</span>
                    <span className="text-[10.5px] text-muted-foreground">{hit.meta}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center gap-3.5 border-t px-4 py-2 text-[10.5px] text-muted-foreground">
            <span>{t("shell.palette.hintSelect")}</span>
            <span>{t("shell.palette.hintOpen")}</span>
            <span className="flex-1" />
            <span>{t("shell.palette.results", { count: hits.length })}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
