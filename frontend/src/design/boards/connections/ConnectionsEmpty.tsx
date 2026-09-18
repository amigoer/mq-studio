import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { AppLogo } from "@/design/icons/AppLogo";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Button } from "@/components/ui/button";
import {
  PROTOCOLS,
  PROTOCOL_ORDER,
  isProtocolReady,
  type ProtocolId,
} from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/*
 * The family grid is capped, so the welcome page keeps its shape however many
 * drivers ship: past this many cells the last one counts the rest and opens the
 * picker, which lists every family with a search.
 */
const COLUMNS = 5;
const ROWS = 3;
/** Wide enough for "Azure Service Bus" on one line, with room for wider system fonts. */
const CELL_WIDTH = 104;

/*
 * The negative margin cancels the padding, so the hover box grows into the row
 * gap instead of spacing the grid out.
 */
const TILE =
  "-my-1.5 h-auto w-full flex-col gap-1.5 rounded-lg px-1 py-1.5 text-[10.5px] font-normal text-(--c-muted) active:scale-[0.97]";
const LIFT =
  "transition-transform duration-(--mo-base) ease-(--mo-ease-out) group-hover:-translate-y-0.5 group-hover:scale-110 group-focus-visible:-translate-y-0.5 group-focus-visible:scale-110";

/** The families drawn in a grid of `cells`, and how many fold into its last cell. */
export function foldProtocols(
  protocols: readonly ProtocolId[],
  cells: number,
): { shown: ProtocolId[]; folded: number } {
  if (protocols.length <= cells) return { shown: [...protocols], folded: 0 };
  const shown = protocols.slice(0, cells - 1);
  return { shown, folded: protocols.length - shown.length };
}

/** Board 8b — first launch, or after the last connection is deleted. */
export function ConnectionsEmpty({
  onNewConnection,
  onImport,
}: {
  /** Given a family, the dialog opens on that family's form. */
  onNewConnection?: (protocol?: ProtocolId) => void;
  onImport?: () => void;
}) {
  const { t } = useTranslation();
  const { shown, folded } = foldProtocols(PROTOCOL_ORDER, COLUMNS * ROWS);
  const supported = t("page.connections.emptySupported", {
    count: PROTOCOL_ORDER.filter(isProtocolReady).length,
  });

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            background: "var(--c-bg)",
            border: "1.5px solid var(--c-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppLogo width={40} height={27} />
        </div>
        <div style={{ fontSize: "19px", fontWeight: 600, marginTop: "18px", letterSpacing: "-.01em" }}>
          {t("page.connections.welcome")}
        </div>
        <div style={{ fontSize: "12.5px", color: "var(--c-muted)", marginTop: "6px", lineHeight: 1.7 }}>
          {t("page.connections.emptyLine1")}
          <br />
          {t("page.connections.emptyLine2")}
        </div>
        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
          <Button style={{ padding: "6px 16px" }} onClick={() => onNewConnection?.()}>
            <Plus size={13} aria-hidden />
            {t("page.connections.emptyNew")}
          </Button>
          <Button
            variant="outline"
            style={{ padding: "6px 16px" }}
            disabled={onImport == null}
            onClick={onImport}
          >
            {t("page.connections.emptyImport")}
          </Button>
        </div>

        <div className="mt-8 flex items-center gap-3 text-[11px] text-(--c-muted-2)">
          <span className="h-px w-12 bg-border" aria-hidden />
          {supported}
          <span className="h-px w-12 bg-border" aria-hidden />
        </div>
        {/* A family without a driver is greyed here too, so the grid matches
            what the connection dialog will let you pick. The last row centres,
            since a partly filled one pinned left reads as something missing. */}
        <ul
          aria-label={supported}
          className="mt-4 flex flex-wrap justify-center gap-y-3.5"
          style={{ width: COLUMNS * CELL_WIDTH }}
        >
          {shown.map((p) => {
            const ready = isProtocolReady(p);
            return (
              <li key={p} className="flex" style={{ width: CELL_WIDTH }}>
                <Button
                  variant="ghost"
                  title={PROTOCOLS[p].name}
                  disabled={!ready}
                  className={cn(
                    TILE,
                    "group has-[>svg]:px-1 disabled:text-(--c-muted-2) disabled:opacity-100",
                  )}
                  onClick={() => onNewConnection?.(p)}
                >
                  {/* A size- class keeps Button's icon rule from shrinking it. */}
                  <ProtocolIcon
                    protocol={p}
                    size={20}
                    className={cn("size-[20px]", LIFT)}
                    style={ready ? undefined : { filter: "grayscale(1)", opacity: 0.4 }}
                  />
                  <span className="max-w-full truncate">{PROTOCOLS[p].name}</span>
                </Button>
              </li>
            );
          })}
          {folded > 0 && (
            <li className="flex" style={{ width: CELL_WIDTH }}>
              <Button variant="ghost" className={cn(TILE, "group")} onClick={() => onNewConnection?.()}>
                <span
                  className={cn(
                    "flex h-5 items-center text-xs font-semibold text-(--c-fg-2) tabular-nums",
                    LIFT,
                  )}
                >
                  +{folded}
                </span>
                {t("page.connections.emptyAllProtocols")}
              </Button>
            </li>
          )}
        </ul>

        <div style={{ fontSize: "10.5px", color: "var(--c-muted-3)", marginTop: "26px" }}>
          {t("page.connections.emptyFooter")}
        </div>
      </div>
    </div>
  );
}
