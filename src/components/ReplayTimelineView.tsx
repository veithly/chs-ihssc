import { CheckCircledIcon, CrossCircledIcon, PersonIcon } from "@radix-ui/react-icons";
import type { ReplayEvent } from "@/lib/types";

const PHASE_LABEL: Record<string, string> = {
  observe: "observe",
  plan: "plan",
  tools: "tools",
  mutate: "mutate",
  verify: "verify",
  recover: "recover",
};

export function ReplayTimelineView({ events }: { events: (ReplayEvent & { human?: boolean })[] }) {
  return (
    <ol className="replay-timeline" data-replay>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const Icon = e.human ? PersonIcon : e.ok ? CheckCircledIcon : CrossCircledIcon;
        const color = e.human
          ? "var(--gate-violet)"
          : e.ok
            ? "var(--gate-green)"
            : "var(--gate-red)";
        return (
          <li
            key={i}
            className={`replay-event ${e.human ? "human" : e.ok ? "ok" : "err"}`}
            style={{ paddingBottom: last ? 0 : 22 }}
          >
            {!last && <span className="replay-line" aria-hidden />}
            <span className="replay-icon" style={{ color }}>
              <Icon width={18} height={18} />
            </span>
            <div className="replay-body">
              <div className="replay-head">
                <span className="replay-title">{e.title}</span>
                <span className="replay-meta mono">
                  <span className="replay-phase">{PHASE_LABEL[e.phase] ?? e.phase}</span>
                  <span className="replay-time">{e.at.slice(11, 19)}</span>
                </span>
              </div>
              <div className="replay-detail">{e.detail}</div>
            </div>
          </li>
        );
      })}
      <style>{`
        .replay-timeline {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }
        .replay-event {
          position: relative;
          padding-left: 32px;
        }
        .replay-line {
          position: absolute;
          left: 10px;
          top: 24px;
          bottom: -4px;
          width: 2px;
          background: var(--gate-border);
        }
        .replay-icon {
          position: absolute;
          left: 0;
          top: 0;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-elevated);
          z-index: 1;
        }
        .replay-body { min-width: 0; }
        .replay-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
          flex-wrap: wrap;
        }
        .replay-title {
          font-weight: 600;
          font-size: 13.5px;
          color: var(--gate-ink);
        }
        .replay-meta {
          font-size: 11px;
          color: var(--ink-3);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .replay-phase {
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--surface-sunken);
          color: var(--gate-ink-soft);
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .replay-event.human .replay-phase {
          background: var(--gate-violet-soft);
          color: var(--gate-violet);
        }
        .replay-event.err .replay-phase {
          background: var(--gate-red-soft);
          color: var(--gate-red);
        }
        .replay-time { white-space: nowrap; }
        .replay-detail {
          font-size: 12.5px;
          color: var(--gate-ink-soft);
          marginTop: 4px;
          line-height: 1.55;
          margin-top: 4px;
        }
      `}</style>
    </ol>
  );
}
