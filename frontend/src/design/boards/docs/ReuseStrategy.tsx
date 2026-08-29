import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

type Strategy = "reuse" | "adapt" | "separate";

const TONE: Record<Strategy, { tone: "ok" | "warn" | "err"; label: string }> = {
  reuse: { tone: "ok", label: "board.docs.reuse.reuse" },
  adapt: { tone: "warn", label: "board.docs.reuse.adapt" },
  separate: { tone: "err", label: "board.docs.reuse.separate" },
};

const ROWS: readonly { page: string; strategy: Strategy; note: string }[] = [
  { page: "board.docs.reuse.connectionsPage", strategy: "reuse", note: "board.docs.reuse.connectionsNote" },
  { page: "board.docs.reuse.dataPagesPage", strategy: "adapt", note: "board.docs.reuse.dataPagesNote" },
  { page: "board.docs.reuse.amqpPage", strategy: "separate", note: "board.docs.reuse.amqpNote" },
  { page: "board.docs.reuse.mqttPage", strategy: "separate", note: "board.docs.reuse.mqttNote" },
  { page: "board.docs.reuse.pulsarPage", strategy: "adapt", note: "board.docs.reuse.pulsarNote" },
  { page: "board.docs.reuse.redisPage", strategy: "adapt", note: "board.docs.reuse.redisNote" },
];

/** Board 4d — how each page is built across protocols. */
export function ReuseStrategy() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.docs.reuse.title")}
        subtitle={t("board.docs.reuse.subtitle")}
      />
      <PageBody>
        <div className="mqs-scroll" style={{ maxWidth: "860px", width: "100%", margin: "0 auto" }}>
          <Table style={{ fontSize: "11.5px" }}>
            <THead>
              <TR>
                <TH style={{ width: "260px" }}>{t("board.common.page")}</TH>
                <TH style={{ width: "110px" }}>{t("board.common.policy")}</TH>
                <TH>{t("board.docs.reuse.note")}</TH>
              </TR>
            </THead>
            <TBody>
              {ROWS.map((row) => (
                <TR key={row.page}>
                  {/* The row's identity: it wraps rather than being clipped
                      to the drawn 260px, which no language's list of pages fits. */}
                  <TD style={{ whiteSpace: "normal" }}>{t(row.page)}</TD>
                  <TD>
                    <Status tone={TONE[row.strategy].tone}>{t(TONE[row.strategy].label)}</Status>
                  </TD>
                  <TD style={{ whiteSpace: "normal", color: "var(--c-mono-dim)" }}>{t(row.note)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div style={{ padding: "10px 14px 6px", fontSize: "11px", color: "var(--c-muted)" }}>
            {t("board.docs.reuse.advice")}
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
