import { CheckCircledIcon, CrossCircledIcon, PersonIcon } from "@radix-ui/react-icons";
import type { ReplayEvent } from "@/lib/types";

export function ReplayTimelineView({ events }: { events: (ReplayEvent & { human?: boolean })[] }) {
  return (
    <div data-replay style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const Icon = e.human ? PersonIcon : e.ok ? CheckCircledIcon : CrossCircledIcon;
        const color = e.human
          ? "var(--gate-violet)"
          : e.ok
            ? "var(--gate-green)"
            : "var(--gate-red)";
        return (
          <div key={i} style={{ position: "relative", paddingLeft: 34, paddingBottom: last ? 0 : 22 }}>
            {!last && <span className="timeline-line" />}
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color,
                background: "#fff",
                zIndex: 1,
              }}
            >
              <Icon width={20} height={20} />
            </span>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{e.title}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--gate-ink-soft)", whiteSpace: "nowrap" }}>
                {e.at.slice(11, 19)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--gate-ink-soft)", marginTop: 4, lineHeight: 1.55 }}>
              {e.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
}
