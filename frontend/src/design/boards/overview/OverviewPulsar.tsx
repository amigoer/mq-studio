import { useTranslation } from "react-i18next";
import { Page, PageBody } from "@/design/shell";
import { Notice } from "@/design/boards/BoardState";
import { Layers } from "lucide-react";
import { OverviewHeader } from "./_shared";

/**
 * Board 11c — Pulsar overview.
 *
 * The figures this board used to draw were the design canvas's, invented to
 * show the shape of the page. They are gone rather than kept until a hook
 * replaces them: a board of made-up numbers beside a live cluster is worse
 * than a board that says it has nothing yet, because only one of them can be
 * mistaken for the user's own data.
 *
 * Each page comes back in the commit that gives it a driver to read.
 */
export function OverviewPulsar() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.pulsar.subtitle")} />
      <PageBody>
        <Notice icon={<Layers size={22} aria-hidden />} title={t("board.overview.pulsar.pending")}>
          {t("board.overview.pulsar.pendingHint")}
        </Notice>
      </PageBody>
    </Page>
  );
}
