import Link from "next/link";
import { Flex } from "@radix-ui/themes";

const NAV: { href: string; label: string }[] = [
  { href: "/workspace", label: "工作台" },
  { href: "/queue", label: "批次队列" },
  { href: "/import", label: "批次导入" },
  { href: "/morning", label: "价格晨会" },
  { href: "/settings", label: "设置" },
];

export function AppHeader({ active }: { active?: string }) {
  return (
    <header className="app-header" data-app-header>
      <Flex
        className="app-header-inner"
        align="center"
        justify="between"
        px="5"
        style={{ height: 56, maxWidth: 1320, margin: "0 auto" }}
      >
        <Link href="/workspace" className="app-brand" aria-label="价序首页">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logomark.svg" alt="" width={26} height={26} />
          <Flex align="center" gap="2" className="app-brand-text">
            <span className="app-brand-name">价序</span>
            <span className="app-brand-tag mono">价格复核助手</span>
          </Flex>
        </Link>

        <Flex align="center" gap="1" asChild>
          <nav className="app-nav" aria-label="主导航">
            {NAV.map((n) => {
              const isActive = active === n.label || active === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`app-nav-link${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </Flex>
      </Flex>

      <style>{`
        .app-header {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: saturate(180%) blur(10px);
          -webkit-backdrop-filter: saturate(180%) blur(10px);
          border-bottom: 1px solid var(--gate-border);
        }
        .app-brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 6px 4px;
          border-radius: 8px;
          transition: opacity 140ms var(--ease-soft);
        }
        .app-brand:hover { opacity: 0.85; }
        .app-brand-name {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--gate-ink);
        }
        .app-brand-tag {
          font-size: 10.5px;
          font-weight: 500;
          color: var(--ink-3);
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--surface-sunken);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .app-nav {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .app-nav-link {
          padding: 7px 12px;
          border-radius: 7px;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--gate-ink-soft);
          transition: background 140ms var(--ease-soft), color 140ms var(--ease-soft);
          white-space: nowrap;
        }
        .app-nav-link:hover {
          background: var(--surface-sunken);
          color: var(--gate-ink);
        }
        .app-nav-link.active {
          color: var(--gate-ink);
          background: var(--surface-sunken);
          font-weight: 600;
        }

        @media (max-width: 820px) {
          .app-header-inner { padding: 0 14px !important; }
          .app-brand-tag { display: none; }
          .app-nav-link { padding: 6px 8px; font-size: 12.5px; }
        }
        @media (max-width: 560px) {
          .app-brand-text { display: none; }
        }
      `}</style>
    </header>
  );
}

export function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div className="app-breadcrumb" aria-label="面包屑">
      {items.map((it, i) => (
        <span key={i} className="app-breadcrumb-item">
          {i > 0 && <span className="app-breadcrumb-sep" aria-hidden>›</span>}
          <span className={i === items.length - 1 ? "current" : ""}>{it}</span>
        </span>
      ))}
      <style>{`
        .app-breadcrumb {
          max-width: 1320px;
          margin: 0 auto;
          padding: 14px 24px 0;
          font-size: 12.5px;
          color: var(--ink-3);
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0;
        }
        .app-breadcrumb-item {
          display: inline-flex;
          align-items: center;
        }
        .app-breadcrumb-sep {
          margin: 0 8px;
          color: var(--ink-3);
          opacity: 0.5;
          font-size: 12px;
        }
        .app-breadcrumb-item .current {
          color: var(--gate-ink-soft);
          font-weight: 500;
        }
        @media (max-width: 720px) {
          .app-breadcrumb { padding: 12px 14px 0; }
        }
      `}</style>
    </div>
  );
}
