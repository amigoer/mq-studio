import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Card, SectionLabel } from "@/design/ui";

/**
 * The sidebar reaches 告警 and ACL on every protocol, but the canvas has no
 * artboard for either — they are named in 3h and 4d only. Rather than invent a
 * layout, the page says so and points at what does exist.
 */
export function NotDesigned({
  labelKey,
  protocolName,
}: {
  /** The sidebar entry this page sits behind, as a locale key. */
  labelKey: string;
  protocolName: string;
}) {
  const { t } = useTranslation();
  const label = t(labelKey);
  return (
    <Page>
      <PageHeader
        title={label}
        subtitle={t("board.notDesigned.subtitle", { protocol: protocolName })}
      />
      <PageBody>
        <Card
          style={{
            margin: "auto",
            maxWidth: "520px",
            padding: "28px 32px",
            textAlign: "center",
          }}
        >
          <SectionLabel>{t("board.notDesigned.title")}</SectionLabel>
          <div style={{ fontSize: "13px", marginTop: "10px", lineHeight: 1.8 }}>
            {t("board.notDesigned.note", { page: label })}
          </div>
          <div style={{ fontSize: "11px", color: "var(--c-muted)", marginTop: "12px", lineHeight: 1.7 }}>
            {t("board.notDesigned.line1")}
            <br />
            {t("board.notDesigned.line2")}
          </div>
        </Card>
      </PageBody>
    </Page>
  );
}
