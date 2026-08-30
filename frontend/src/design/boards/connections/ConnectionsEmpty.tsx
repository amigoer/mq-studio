import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { AppLogo } from "@/design/icons/AppLogo";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Button } from "@/components/ui/button";
import { PROTOCOLS, PROTOCOL_ORDER, isProtocolReady } from "@/design/data/protocols";

/** Board 8b — first launch, or after the last connection is deleted. */
export function ConnectionsEmpty({
  onNewConnection,
  onImport,
}: {
  onNewConnection?: () => void;
  onImport?: () => void;
}) {
  const { t } = useTranslation();
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
          maxWidth: "440px",
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
        <div style={{ display: "flex", gap: "18px", marginTop: "34px", alignItems: "center" }}>
          {/* The five without a driver are greyed here too, so the strip
              matches what the connection dialog will let you pick. */}
          {PROTOCOL_ORDER.map((p) => {
            const ready = isProtocolReady(p);
            return (
              <span
                key={p}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "5px",
                  fontSize: "10px",
                  color: ready ? "var(--c-muted)" : "var(--c-muted-2)",
                }}
              >
                <ProtocolIcon
                  protocol={p}
                  size={20}
                  className=""
                  style={ready ? undefined : { filter: "grayscale(1)", opacity: 0.4 }}
                />
                {PROTOCOLS[p].name}
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: "10.5px", color: "var(--c-muted-3)", marginTop: "26px" }}>
          {t("page.connections.emptyFooter")}
        </div>
      </div>
    </div>
  );
}
