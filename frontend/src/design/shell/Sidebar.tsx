import { Fragment } from "react";
import { PROTOCOLS, type PageId, type ProtocolId } from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/** `.side3` — 198px rail, grouped by 浏览 / 运维, labelled per protocol. */
export function Sidebar({
  protocol,
  active,
  onSelect,
}: {
  protocol: ProtocolId;
  active: PageId;
  onSelect?: (page: PageId) => void;
}) {
  return (
    <nav className="side3">
      {PROTOCOLS[protocol].nav.map((group, gi) => (
        <Fragment key={group.label ?? `g${gi}`}>
          {group.label != null && <div className="gl">{group.label}</div>}
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === active ? "page" : undefined}
              className={cn("ni", item.id === active && "on")}
              onClick={() => onSelect?.(item.id)}
            >
              <span className="nic">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </Fragment>
      ))}
      <div style={{ flex: 1 }} />
    </nav>
  );
}
