import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ProtoBadge,
} from "@/components";
import { PROTOCOL_ORDER } from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/**
 * `●` supported, `◐` partial or needs configuration, `—` not applicable.
 *
 * A cell is the glyph, optionally followed by what qualifies it. The qualifier
 * is a locale key where it is prose and a literal where it is a protocol's own
 * term -- `XRANGE` and `Broker/Ctrl` are the same in either language, and
 * keying them would only add a translation that reads back as itself.
 */
type Cell = string;

const ROWS: readonly (readonly [string, ...Cell[]])[] = [
  ["board.docs.capability.overviewMetrics", "●", "●", "●", "●", "●", "◐ $SYS / REST"],
  ["board.docs.capability.topicMgmt", "●", "●", "● board.docs.capability.queuesExchanges", "● board.docs.capability.withNamespace", "● Stream", "◐ board.docs.capability.treeReadOnly"],
  ["board.docs.capability.messageQuery", "● board.docs.capability.byKeyIdTime", "● board.docs.capability.byOffsetTime", "◐ board.docs.capability.headOnly", "● board.docs.capability.cursor", "● XRANGE", "◐ board.docs.capability.liveOnly"],
  ["board.docs.capability.trace", "●", "—", "—", "—", "—", "—"],
  ["board.docs.capability.send", "●", "●", "●", "●", "●", "●"],
  ["board.docs.capability.groups", "● board.docs.capability.group", "● board.docs.capability.group", "◐ board.docs.capability.connChannel", "● board.docs.capability.subscription", "● board.docs.capability.group", "◐ board.docs.capability.session"],
  ["board.docs.capability.dlq", "●", "◐ board.docs.capability.dltConvention", "● DLX", "●", "◐ PEL/claim", "—"],
  ["board.docs.capability.resetOffset", "●", "●", "—", "● seek", "● XSETID", "—"],
  ["board.docs.capability.nodeOps", "● Broker/NS", "● Broker/Ctrl", "● board.docs.capability.node", "◐ Broker+Bookie", "◐ INFO", "◐ $SYS / REST"],
  ["board.docs.capability.acl", "●", "●", "◐ board.docs.capability.userVhost", "◐ board.docs.capability.tokenReadOnly", "—", "—"],
  ["board.docs.capability.delayed", "●", "—", "◐ board.docs.capability.plugin", "●", "—", "—"],
];

/** Cell tone follows the leading glyph. */
const TONE = {
  y: "text-(--c-ok-text)",
  p: "text-(--c-warn-text)",
  n: "text-(--c-disabled)",
} as const;

function toneOf(cell: string): keyof typeof TONE {
  if (cell.startsWith("\u25cf")) return "y";
  if (cell.startsWith("\u25d0")) return "p";
  return "n";
}

/** Board 3h -- which module each protocol can actually support. */
export function CapabilityMatrix() {
  const { t } = useTranslation();
  const cellText = (cell: Cell) => {
    const note = cell.slice(2);
    if (note === "") return cell;
    return `${cell.slice(0, 1)} ${note.startsWith("board.") ? t(note) : note}`;
  };
  return (
    <Page>
      <PageHeader
        title={t("board.docs.capability.title")}
        subtitle={t("board.docs.capability.subtitle")}
      />
      <PageBody>
        <div className="mqs-scroll" style={{ maxWidth: "860px", width: "100%", margin: "0 auto" }}>
          <Table style={{ fontSize: "11.5px" }}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.docs.capability.module")}</TableHead>
                {PROTOCOL_ORDER.map((p) => (
                  <TableHead key={p} style={{ textAlign: "center" }}>
                    <ProtoBadge protocol={p} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map(([label, ...cells]) => (
                <TableRow key={label}>
                  <TableCell>{t(label)}</TableCell>
                  {cells.map((cell, i) => (
                    <TableCell key={i} className={cn("text-center text-base whitespace-normal", TONE[toneOf(cell)])}>
                      {cellText(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageBody>
    </Page>
  );
}
