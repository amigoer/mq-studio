import { Page, PageBody, PageHeader } from "@/design/shell";
import { Card, SectionLabel } from "@/design/ui";

/**
 * The sidebar reaches 告警 and ACL on every protocol, but the canvas has no
 * artboard for either — they are named in 3h and 4d only. Rather than invent a
 * layout, the page says so and points at what does exist.
 */
export function NotDesigned({
  title,
  subtitle,
  note,
}: {
  title: string;
  subtitle: string;
  note: string;
}) {
  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} />
      <PageBody>
        <Card
          style={{
            margin: "auto",
            maxWidth: "520px",
            padding: "28px 32px",
            textAlign: "center",
          }}
        >
          <SectionLabel>设计稿待补</SectionLabel>
          <div style={{ fontSize: "13px", marginTop: "10px", lineHeight: 1.8 }}>{note}</div>
          <div style={{ fontSize: "11px", color: "var(--c-muted)", marginTop: "12px", lineHeight: 1.7 }}>
            该模块在能力矩阵（3h）与复用策略（4d）中已定义，但没有对应画板。
            <br />
            补稿后按同一套 shell 与组件实现即可。
          </div>
        </Card>
      </PageBody>
    </Page>
  );
}
