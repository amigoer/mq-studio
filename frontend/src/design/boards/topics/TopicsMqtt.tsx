import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KV, Panel, PanelHeader, SectionLabel } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useMqttTopics } from "@/hooks/mqtt/useMqttBroker";
import { topic as readTopic, topicTree, type MqttTopic, type TopicNode } from "@/mq/mqtt/destinations";
import { formatBytes, formatCount } from "@/lib/format";

const MONO11 = { fontSize: "11px" } as const;

/** One branch of the tree, drawn with its own children under it. */
function Branch({
  node,
  depth,
  open,
  onToggle,
  onSelect,
  selected,
}: {
  node: TopicNode;
  depth: number;
  open: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (topic: MqttTopic) => void;
  selected: string | null;
}) {
  const expanded = open.has(node.path);
  const Caret = expanded ? ChevronDown : ChevronRight;
  const isLeaf = node.children.length === 0;

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isLeaf ? undefined : expanded}
        aria-selected={node.topic != null && node.topic.name === selected}
        style={{
          padding: `4px 8px 4px ${8 + depth * 14}px`,
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "12px",
          cursor: "pointer",
          // A branch with no topic of its own exists only because something
          // below it does, which is worth showing as exactly that.
          color: node.topic == null ? "var(--c-muted)" : undefined,
        }}
        onClick={() => {
          if (!isLeaf) onToggle(node.path);
          if (node.topic != null) onSelect(node.topic);
        }}
      >
        {isLeaf ? <span style={{ width: "12px" }} /> : <Caret size={12} aria-hidden />}
        {node.label === "" ? <em>{"(empty)"}</em> : node.label}
        {!isLeaf && (
          <span className="mono3" style={{ ...MONO11, marginLeft: "auto", color: "var(--c-muted-2)" }}>
            {node.total}
          </span>
        )}
      </div>
      {expanded &&
        node.children.map((child) => (
          <Branch
            key={child.path}
            node={child}
            depth={depth + 1}
            open={open}
            onToggle={onToggle}
            onSelect={onSelect}
            selected={selected}
          />
        ))}
    </>
  );
}

/**
 * Board 11b — MQTT topics.
 *
 * The page answers a different question from every other family's topic list,
 * and says so. MQTT has no topic registry: a topic exists while a message is
 * in flight to it and not otherwise, so there is nothing to enumerate. What
 * there is is the retained message - a topic's last known value, which the
 * broker replays to whoever subscribes next - and that is what this lists.
 *
 * So a device publishing without the retain flag does not appear here, and its
 * absence is not a fault. The notice says that outright rather than leaving an
 * operator to conclude their device is not publishing.
 *
 * The tree's branches are inferred from the leaves, because there is nothing
 * else to infer them from: MQTT topics are a path and no broker keeps a list
 * of the levels in between.
 */
export function TopicsMqtt() {
  const { t } = useTranslation();
  const state = useMqttTopics();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MqttTopic | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const topics = useMemo(() => (state.data ?? []).map(readTopic), [state.data]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return topics;
    return topics.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [topics, search]);

  const tree = useMemo(() => topicTree(shown), [shown]);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const detail = selected ?? shown[0] ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.mqtt.topics")}
        subtitle={t("board.topics.mqtt.count", { count: topics.length })}
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Input
              style={{ width: "200px" }}
              value={search}
              placeholder={t("board.topics.mqtt.search")}
              onChange={(event) => setSearch(event.target.value)}
            />
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </div>
        }
      />
      <BoardState state={state}>
        <PageBody>
          {/*
            A note rather than the amber warning strip: this is not a fault,
            it is what the listing means. Leaving it out would have an operator
            conclude a device is not publishing when it is simply not
            retaining; dressing it as a warning would say something is wrong.
          */}
          <p
            style={{
              margin: "0 20px",
              fontSize: "11.5px",
              color: "var(--c-muted)",
              flex: "none",
            }}
          >
            {t("board.topics.mqtt.retainedOnly")}
          </p>

          <div style={{ display: "flex", gap: "12px", minHeight: 0, flex: 1 }}>
            <Panel style={{ width: "280px", flex: "none", overflow: "auto" }}>
              <PanelHeader title={t("board.mqtt.topicTree")} />
              <div role="tree">
                {tree.map((node) => (
                  <Branch
                    key={node.path}
                    node={node}
                    depth={0}
                    open={open}
                    onToggle={toggle}
                    onSelect={setSelected}
                    selected={detail?.name ?? null}
                  />
                ))}
              </div>
            </Panel>

            <Panel style={{ flex: 1, minWidth: 0 }}>
              <PanelHeader title={t("board.topics.mqtt.retained")} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.mqtt.topic")}</TableHead>
                    <TableHead>QoS</TableHead>
                    <TableHead style={{ textAlign: "right" }}>
                      {t("board.topics.mqtt.size")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((entry) => (
                    <TableRow
                      key={entry.name}
                      onClick={() => setSelected(entry)}
                      aria-selected={detail?.name === entry.name}
                    >
                      <TableCell className="mono3" style={MONO11}>
                        {entry.name}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {entry.qos == null ? "—" : entry.qos}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...MONO11, textAlign: "right" }}>
                        {entry.retainedBytes == null ? "—" : formatBytes(entry.retainedBytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>

            <Panel style={{ width: "260px", flex: "none" }}>
              <PanelHeader title={t("board.topics.mqtt.detail")} />
              {detail == null ? (
                <div style={{ padding: "14px", fontSize: "12px", color: "var(--c-muted)" }}>
                  {t("board.topics.mqtt.none")}
                </div>
              ) : (
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <KV
                    rows={[
                      [t("board.mqtt.topic"), detail.name],
                      [t("board.topics.mqtt.levels"), formatCount(detail.levels.length)],
                      [
                        t("board.topics.mqtt.size"),
                        detail.retainedBytes == null ? "—" : formatBytes(detail.retainedBytes),
                      ],
                    ]}
                  />
                  <SectionLabel>{t("board.topics.mqtt.why")}</SectionLabel>
                  <p style={{ fontSize: "11.5px", color: "var(--c-muted)", margin: 0 }}>
                    {t("board.topics.mqtt.whyBody")}
                  </p>
                </div>
              )}
            </Panel>
          </div>
        </PageBody>
      </BoardState>
    </Page>
  );
}
