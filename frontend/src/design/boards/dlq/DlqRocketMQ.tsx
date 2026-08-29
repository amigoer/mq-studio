import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Check,
  Seg,
  SelectField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { Trans, useTranslation } from "react-i18next";

const VIEWS = [
  { value: "retry", label: "board.dlq.rocketmq.retryQueue" },
  { value: "dlq", label: "board.dlq.rocketmq.dlqQueue" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const R = { textAlign: "right" } as const;

type Row = {
  id: string;
  msgId: string;
  topic: string;
  key: string;
  retries: string;
  reason: string;
  at: string;
};

const ROWS: readonly Row[] = [
  { id: "9A1", msgId: "7F00…9A1", topic: "ORDER_CREATE", key: "ORD-87990", retries: "16", reason: "RemotingTimeout: 3000ms", at: "09:41:22" },
  { id: "9A4", msgId: "7F00…9A4", topic: "ORDER_CREATE", key: "ORD-88102", retries: "16", reason: "NPE at OrderService.java:112", at: "10:02:37" },
  { id: "9B0", msgId: "7F00…9B0", topic: "ORDER_CREATE", key: "ORD-88155", retries: "16", reason: "DB connection refused", at: "10:18:03" },
];

/**
 * Board 9b — RocketMQ %RETRY% / %DLQ%. Redelivery writes a fresh MsgId and
 * leaves the original in place, so the confirm step spells that out.
 */
export function DlqRocketMQ() {
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("dlq");
  const [checked, setChecked] = useState<string[]>(["9A1", "9A4"]);
  const [confirming, setConfirming] = useState(false);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.common.dlqRetry")}
        subtitle={t("board.dlq.rocketmq.subtitle")}
        actions={<Btn>{t("board.dlq.rocketmq.exportAll")}</Btn>}
      />
      <Toolbar>
        <SelectField value={t("board.dlq.rocketmq.group")} />
        <Seg options={VIEWS.map((o) => ({ ...o, label: t(o.label) }))} value={view} onChange={setView} />
        <SelectField value={t("board.dlq.last24h")} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListPane>
        <Table className="inset">
          <THead>
            <TR>
              <TH style={{ width: "28px" }}>
                <Check
                  checked={allChecked}
                  label={t("board.common.selectAll")}
                  onChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TH>
              <TH>MsgId</TH>
              <TH>{t("board.dlq.rocketmq.originTopic")}</TH>
              <TH>Key</TH>
              <TH style={R}>{t("board.common.retry")}</TH>
              <TH>{t("board.dlq.rocketmq.lastFailure")}</TH>
              <TH>{t("board.dlq.rocketmq.deadAt")}</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "var(--c-mono-dim)";
              return (
                <TR key={row.id} selected={on}>
                  <TD>
                    <Check checked={on} label={row.msgId} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.msgId}</TD>
                  <TD className="mono3" style={DIM11}>{row.topic}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.retries}</TD>
                  <TD style={{ color: on ? "var(--c-err-text)" : "var(--c-muted)", maxWidth: "200px" }}>{row.reason}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={7} widths={["68%", "54%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.rocketmq.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Btn variant="primary" onClick={() => setConfirming(true)}>
          {t("board.dlq.rocketmq.resend")}
        </Btn>
        <Btn>{t("board.common.export")}</Btn>
        <Btn variant="danger">{t("board.common.delete")}</Btn>
      </BulkBar>

      {confirming && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--c-scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 6,
          }}
          onClick={() => setConfirming(false)}
        >
          <Card
            role="alertdialog"
            aria-label={t("board.dlq.rocketmq.confirmLabel")}
            style={{ width: "420px", boxShadow: "0 18px 50px rgba(0,0,0,.22)", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px 4px" }}>
              <b style={{ fontSize: "13.5px" }}>
                {t("board.dlq.rocketmq.confirmTitle", { n: checked.length })}
              </b>
            </div>
            <div
              style={{
                padding: "8px 20px 16px",
                fontSize: "12px",
                color: "var(--c-fg-2)",
                lineHeight: 1.7,
              }}
            >
              <Trans
                i18nKey="board.dlq.rocketmq.confirmBody"
                components={{
                  b: <b />,
                  topic: <span className="mono3" style={MONO11} />,
                  group: <span className="mono3" style={MONO11} />,
                }}
                values={{ topic: "ORDER_CREATE", group: "order-settle" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                padding: "12px 20px",
                borderTop: "1px solid var(--c-border)",
                background: "var(--c-panel)",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--c-muted)", alignSelf: "center" }}>
                {t("board.dlq.rocketmq.risky")}
              </span>
              <span style={{ flex: 1 }} />
              <Btn onClick={() => setConfirming(false)}>{t("board.common.cancel")}</Btn>
              <Btn variant="primary" onClick={() => setConfirming(false)}>
                {t("board.dlq.rocketmq.confirmAction")}
              </Btn>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
