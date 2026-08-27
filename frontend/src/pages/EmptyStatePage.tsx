import {
  Github,
  Plus,
  Download,
  HardDrive,
  Box,
  Server,
  Layers,
  Activity,
  Lock,
  Shield,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { SectionLabel } from "@/components/SectionLabel";
import { setConnectionPrefill } from "@/lib/connectionPrefill";
import { importAllConfigFromFile } from "@/api/settings";
import { openExternal as openExternalLink } from "@/api/platform";
import * as connectionApi from "@/api/connection";
import { useConnections } from "@/hooks/useConnections";
import { useSettings } from "@/hooks/useSettings";
import { formatErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const GITHUB_URL = "https://github.com/amigoer/mq-studio";
const DOCS_URL = "https://github.com/amigoer/mq-studio#readme";

type SampleKey = "local" | "docker" | "paste";

const SAMPLES: {
  key: SampleKey;
  host: string;
  env: string;
  icon: LucideIcon;
  ghost?: boolean;
}[] = [
  {
    key: "local",
    host: "127.0.0.1:9876",
    env: "DEV",
    icon: HardDrive,
  },
  {
    key: "docker",
    host: "rocketmq:9876",
    env: "DEV",
    icon: Box,
  },
  {
    key: "paste",
    host: "host:9876;host2:9876",
    env: "—",
    icon: Plus,
    ghost: true,
  },
];

const STEP_ICONS = [Server, Layers, Activity] as const;

export function EmptyStatePage({
  onAddConnection,
}: {
  onAddConnection?: () => void;
}) {
  const { t } = useTranslation();
  const { refresh: refreshConnections } = useConnections();
  const { reloadSettings, settlePendingSaves } = useSettings();

  const openNew = (prefill?: {
    name?: string;
    host?: string;
    port?: string;
    nameServer?: string;
  }) => {
    if (prefill) setConnectionPrefill(prefill);
    else setConnectionPrefill({});
    onAddConnection?.();
  };

  const handleSample = async (key: SampleKey) => {
    if (key === "paste") {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) {
          openNew({
            nameServer: text,
            name: t("emptyState.samples.paste.name"),
          });
          return;
        }
        toast.info(t("emptyState.clipboardEmpty"));
      } catch {
        toast.info(t("emptyState.clipboardEmpty"));
      }
      openNew({});
      return;
    }
    if (key === "local") {
      openNew({
        name: t("emptyState.samples.local.name"),
        host: "127.0.0.1",
        port: "9876",
      });
      return;
    }
    if (key === "docker") {
      openNew({
        name: t("emptyState.samples.docker.name"),
        host: "rocketmq",
        port: "9876",
      });
    }
  };

  const handleImport = async () => {
    try {
      await settlePendingSaves();
      const path = await importAllConfigFromFile();
      if (!path) return;
      await reloadSettings();
      await connectionApi.connectDefault();
      await refreshConnections();
      toast.success(t("emptyState.importSuccess"), { description: path });
    } catch (e) {
      toast.error(t("emptyState.importError"), {
        description: formatErrorMessage(e),
      });
    }
  };

  const openExternal = (url: string) => {
    openExternalLink(url).catch(() => {});
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("emptyState.title")}
        subtitle={t("emptyState.subtitle")}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openExternal(DOCS_URL)}
        >
          <Github size={13} />
          {t("common.docs")}
        </Button>
        <Button variant="default" size="sm" onClick={() => openNew()}>
          <Plus size={13} />
          {t("emptyState.addConnection")}
        </Button>
      </PageHeader>

      <PageBody width="wide">
        <div className="pb-3">
          {/* Hero */}
          <Card
            style={{ position: "relative", overflow: "hidden", padding: 0 }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(hsl(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.6) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
                maskImage:
                  "radial-gradient(ellipse 60% 75% at 85% 30%, #000 0%, transparent 70%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 60% 75% at 85% 30%, #000 0%, transparent 70%)",
                opacity: 0.45,
              }}
            />

            <div
              className="flex"
              style={{
                position: "relative",
                padding: "20px 22px",
                gap: 20,
                alignItems: "center",
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline" className="h-[1.46rem]">
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: "hsl(var(--muted-foreground))",
                      }}
                    />
                    {t("emptyState.badge")}
                  </Badge>
                  <span className="text-muted-foreground text-fs-12">
                    {t("emptyState.supportNote")}
                  </span>
                </div>
                <div
                  className="text-fs-18 font-semibold"
                  style={{ letterSpacing: "-0.01em", lineHeight: 1.3 }}
                >
                  {t("emptyState.heroTitle")}
                </div>
                <div
                  className="text-muted-foreground mt-1.5 text-fs-12"
                  style={{ maxWidth: "40rem", lineHeight: 1.6 }}
                >
                  {t("emptyState.heroDesc")}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="default" size="sm" onClick={() => openNew()}>
                    <Plus size={13} />
                    {t("emptyState.addConnection")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleImport}>
                    <Download size={12} />
                    {t("emptyState.importFromFile")}
                  </Button>
                </div>
              </div>

              <div
                style={{
                  width: "15.38rem",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <EmptySchematic notConfigured={t("emptyState.badge")} />
              </div>
            </div>
          </Card>

          {/* Quick start */}
          <SectionLabel>{t("emptyState.quickStart")}</SectionLabel>
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          >
            {SAMPLES.map((s) => (
              <button
                key={s.key}
                type="button"
                className="cursor-pointer rounded-xl border border-border/80 bg-card p-3.5 text-left shadow-card transition-colors hover:border-primary/40"
                style={{
                  borderStyle: s.ghost ? "dashed" : "solid",
                  background: s.ghost ? "transparent" : undefined,
                }}
                onClick={() => void handleSample(s.key)}
              >
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: s.ghost ? "transparent" : "hsl(var(--muted))",
                      border: s.ghost
                        ? "1px dashed hsl(var(--border))"
                        : "none",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <s.icon size={13} className="text-muted-foreground" />
                  </div>
                  <span className="text-fs-13 font-medium">
                    {t(`emptyState.samples.${s.key}.name`)}
                  </span>
                  {!s.ghost && (
                    <Badge
                      variant="outline"
                      className="text-fs-10"
                      style={{ marginLeft: "auto" }}
                    >
                      {s.env}
                    </Badge>
                  )}
                </div>
                <div className="font-mono-design text-muted-foreground mt-2 truncate text-fs-12">
                  {s.host}
                </div>
                <div
                  className="text-muted-foreground mt-2 text-fs-12"
                  style={{ lineHeight: 1.5 }}
                >
                  {t(`emptyState.samples.${s.key}.desc`)}
                </div>
              </button>
            ))}
          </div>

          {/* Three-step flow */}
          <SectionLabel>{t("emptyState.workflow")}</SectionLabel>
          <Card style={{ padding: 0 }}>
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
            >
              {STEP_ICONS.map((Icon, i) => {
                const n = String(i + 1) as "1" | "2" | "3";
                return (
                  <div
                    key={n}
                    style={{
                      padding: 14,
                      borderRight:
                        i < 2 ? "1px solid hsl(var(--border))" : "none",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono-design text-muted-foreground tabular-nums text-fs-12">
                        {`0${n}`}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          height: 1,
                          background: "hsl(var(--border))",
                        }}
                      />
                      <Icon size={13} className="text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-fs-13 font-medium">
                      {t(`emptyState.steps.${n}.title`)}
                    </div>
                    <div
                      className="text-muted-foreground mt-1 text-fs-12"
                      style={{ lineHeight: 1.55 }}
                    >
                      {t(`emptyState.steps.${n}.desc`)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Footer */}
          <div
            className="mt-4 flex items-center justify-between"
            style={{
              paddingTop: 12,
              borderTop: "1px solid hsl(var(--border))",
            }}
          >
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="text-muted-foreground flex items-center gap-1 text-fs-12 hover:text-foreground"
                onClick={() => openExternal(GITHUB_URL)}
              >
                <Github size={12} />
                {t("emptyState.links.github")}
              </button>
              <button
                type="button"
                className="text-muted-foreground flex items-center gap-1 text-fs-12 hover:text-foreground"
                onClick={() => openExternal(`${GITHUB_URL}#features`)}
              >
                <Lock size={12} />
                {t("emptyState.links.acl")}
              </button>
              <button
                type="button"
                className="text-muted-foreground flex items-center gap-1 text-fs-12 hover:text-foreground"
                onClick={() =>
                  openExternal(`${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md`)
                }
              >
                <Shield size={12} />
                {t("emptyState.links.docs")}
              </button>
              <button
                type="button"
                className="text-muted-foreground flex items-center gap-1 text-fs-12 hover:text-foreground"
                onClick={() => openExternal(`${GITHUB_URL}/issues`)}
              >
                <AlertCircle size={12} />
                {t("emptyState.links.faq")}
              </button>
            </div>
            <div className="text-muted-foreground text-fs-12">
              {t("emptyState.footer")}
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function EmptySchematic({ notConfigured }: { notConfigured: string }) {
  return (
    <svg
      width={220}
      height={160}
      viewBox="0 0 220 160"
      fill="none"
      style={{ display: "block" }}
    >
      <defs>
        <pattern id="dots" width={4} height={4} patternUnits="userSpaceOnUse">
          <circle
            cx={1}
            cy={1}
            r={0.6}
            fill="hsl(var(--muted-foreground))"
            opacity={0.35}
          />
        </pattern>
      </defs>

      <g>
        <rect
          x={6}
          y={58}
          width={56}
          height={44}
          rx={8}
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
        />
        <rect
          x={14}
          y={66}
          width={40}
          height={3}
          rx={1.5}
          fill="hsl(var(--muted-foreground))"
          opacity={0.4}
        />
        <rect
          x={14}
          y={73}
          width={28}
          height={3}
          rx={1.5}
          fill="hsl(var(--muted-foreground))"
          opacity={0.25}
        />
        <rect
          x={14}
          y={86}
          width={40}
          height={10}
          rx={2}
          fill="hsl(var(--foreground))"
        />
        <text
          x={34}
          y={93.5}
          textAnchor="middle"
          fontSize={6}
          fontFamily="ui-monospace, monospace"
          fill="hsl(var(--background))"
          fontWeight={600}
        >
          MQS
        </text>
      </g>

      <line
        x1={62}
        y1={80}
        x2={92}
        y2={80}
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={1.2}
        strokeDasharray="3 3"
      />
      <line
        x1={118}
        y1={80}
        x2={148}
        y2={80}
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={1.2}
        strokeDasharray="3 3"
        opacity={0.4}
      />

      <rect
        x={92}
        y={64}
        width={34}
        height={32}
        rx={6}
        fill="url(#dots)"
        stroke="hsl(var(--border))"
        strokeDasharray="3 3"
      />
      <text
        x={109}
        y={82}
        textAnchor="middle"
        fontSize={6.5}
        fontFamily="ui-sans-serif, system-ui"
        fill="hsl(var(--muted-foreground))"
        fontWeight={500}
      >
        NameServer
      </text>
      <text
        x={109}
        y={91}
        textAnchor="middle"
        fontSize={5.5}
        fontFamily="ui-sans-serif, system-ui"
        fill="hsl(var(--muted-foreground))"
        opacity={0.7}
      >
        {notConfigured}
      </text>

      <g opacity={0.4}>
        {[40, 69, 98].map((y) => (
          <g key={y}>
            <rect
              x={148}
              y={y}
              width={60}
              height={22}
              rx={5}
              fill="hsl(var(--muted))"
              stroke="hsl(var(--border))"
            />
            <circle
              cx={155}
              cy={y + 11}
              r={1.5}
              fill="hsl(var(--muted-foreground))"
            />
            <rect
              x={160}
              y={y + 9}
              width={42}
              height={2}
              rx={1}
              fill="hsl(var(--muted-foreground))"
              opacity={0.6}
            />
            <rect
              x={160}
              y={y + 13}
              width={28}
              height={2}
              rx={1}
              fill="hsl(var(--muted-foreground))"
              opacity={0.4}
            />
          </g>
        ))}
      </g>

      <text
        x={34}
        y={116}
        textAnchor="middle"
        fontSize={6.5}
        fill="hsl(var(--muted-foreground))"
        fontFamily="ui-sans-serif"
      >
        MQ Studio
      </text>
      <text
        x={178}
        y={134}
        textAnchor="middle"
        fontSize={6.5}
        fill="hsl(var(--muted-foreground))"
        fontFamily="ui-sans-serif"
        opacity={0.55}
      >
        Broker
      </text>
    </svg>
  );
}
