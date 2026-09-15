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

/*
 * The family grid is capped, so the welcome page keeps its shape however many
 * drivers ship: past this many cells the last one counts the rest and opens the
 * picker, which lists every family with a search.
 */
const COLUMNS = 5;
const ROWS = 3;
/** Wide enough for "Azure Service Bus" on one line, with room for wider system fonts. */
const CELL_WIDTH = 104;

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
  onNewConnection?: () => void;
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
          <Button style={{ padding: "6px 16px" }} onClick={onNewConnection}>
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
              <li
                key={p}
                title={PROTOCOLS[p].name}
                className="flex flex-col items-center gap-1.5 text-[10.5px]"
                style={{ width: CELL_WIDTH, color: ready ? "var(--c-muted)" : "var(--c-muted-2)" }}
              >
                <ProtocolIcon
                  protocol={p}
                  size={20}
                  className=""
                  style={ready ? undefined : { filter: "grayscale(1)", opacity: 0.4 }}
                />
                <span className="max-w-full truncate px-1">{PROTOCOLS[p].name}</span>
              </li>
            );
          })}
          {folded > 0 && (
            <li className="flex justify-center" style={{ width: CELL_WIDTH }}>
              <Button
                variant="ghost"
                className="h-auto flex-col gap-1.5 px-2 py-1 text-[10.5px] font-normal text-(--c-muted)"
                onClick={onNewConnection}
              >
                <span className="flex h-5 items-center text-xs font-semibold text-(--c-fg-2) tabular-nums">
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
