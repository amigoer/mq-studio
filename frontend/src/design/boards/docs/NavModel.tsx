import { ArrowLeft, Plus } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Placeholder, SectionLabel } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { useTranslation } from "react-i18next";

const DASHED = {
  border: "1.5px dashed var(--c-border-strong)",
  borderRadius: "12px",
} as const;

const TAB_ACTIVE = {
  border: "1px solid var(--c-border)",
  borderRadius: "7px",
  padding: "3px 10px",
  fontSize: "11px",
  background: "var(--c-bg)",
  boxShadow: "0 1px 2px rgba(0,0,0,.05)",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
} as const;

const TAB_IDLE = {
  borderRadius: "7px",
  padding: "3px 10px",
  fontSize: "11px",
  color: "var(--c-muted)",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
} as const;

/** Board 5c — the three-layer navigation model and where state is isolated. */
export function NavModel() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.docs.nav.title")}
        subtitle={t("board.docs.nav.subtitle")}
      />
      <PageBody>
        <div
          style={{
            maxWidth: "700px",
            width: "100%",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            fontSize: "12px",
            lineHeight: 1.6,
          }}
        >
          <div style={{ ...DASHED, padding: "12px" }}>
            <SectionLabel style={{ marginBottom: "8px" }}>{t("board.docs.nav.windowA")}</SectionLabel>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <span style={TAB_ACTIVE}>
                <ProtocolIcon protocol="rocketmq" size={12} />
                rocketmq-order
              </span>
              <span style={TAB_IDLE}>
                <ProtocolIcon protocol="kafka" size={12} />
                prod-kafka-cn
              </span>
              <span
                style={{
                  display: "inline-flex",
                  borderRadius: "7px",
                  padding: "3px 10px",
                  color: "var(--c-muted)",
                }}
              >
                <Plus size={12} aria-hidden />
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "10.5px",
                  color: "var(--c-muted)",
                }}
              >
                <ArrowLeft size={12} aria-hidden />
                {t("board.docs.nav.tabLayer")}
              </span>
            </div>
            <div
              style={{
                border: "1px solid var(--c-border)",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                gap: "10px",
                background: "var(--c-panel)",
              }}
            >
              <div
                style={{
                  width: "110px",
                  fontSize: "10.5px",
                  color: "var(--c-mono-dim)",
                  lineHeight: 1.9,
                  borderRight: "1px solid var(--c-border)",
                  paddingRight: "10px",
                }}
              >
                {t("board.common.overview")}
                <br />
                <b style={{ color: "var(--c-fg)" }}>
                  {t("board.common.message")}{" "}
                  <ArrowLeft size={11} style={{ verticalAlign: "-1px" }} aria-hidden />
                </b>
                <br />
                Topic
                <br />
                {t("board.docs.nav.consumersEtc")}
              </div>
              <div
                style={{
                  flex: 1,
                  fontSize: "10.5px",
                  color: "var(--c-muted)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  justifyContent: "center",
                }}
              >
                <span>{t("board.docs.nav.pageLayer")}</span>
                <Placeholder width="70%" />
                <Placeholder width="52%" />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
            <div style={{ ...DASHED, flex: 1, padding: "10px 12px", fontSize: "11px", color: "var(--c-mono-dim)" }}>
              <b style={{ color: "var(--c-fg)" }}>{t("board.docs.nav.tearOff")}</b>
              <br />
              {t("board.docs.nav.tearOffNote")}
            </div>
            <div style={{ ...DASHED, flex: 1, padding: "10px 12px", fontSize: "11px", color: "var(--c-mono-dim)" }}>
              <b style={{ color: "var(--c-fg)" }}>{t("board.docs.nav.sideBySide")}</b>
              <br />
              {t("board.docs.nav.sideBySideNote")}
            </div>
          </div>

          <div style={{ fontSize: "11px", color: "var(--c-muted)", lineHeight: 1.7 }}>
            {t("board.docs.nav.isolation")}
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
