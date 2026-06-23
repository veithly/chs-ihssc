import Link from "next/link";
import { Flex } from "@radix-ui/themes";

const NAV = [
  { href: "/release/REL-2026-0623-07", label: "数据通行" },
  { href: "/queue", label: "队列" },
  { href: "/settings", label: "设置" },
];

export function AppHeader({ active }: { active?: string }) {
  return (
    <header
      style={{
        background: "#fff",
        borderBottom: "1px solid var(--gate-border)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <Flex
        align="center"
        justify="between"
        px="5"
        style={{ height: 60, maxWidth: 1180, margin: "0 auto" }}
      >
        <Link href="/">
          <Flex align="center" gap="2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logomark.svg" alt="" width={28} height={28} />
            <span style={{ fontSize: 17, fontWeight: 700 }}>医保可信数据通行 Agent</span>
          </Flex>
        </Link>
        <Flex align="center" gap="1" asChild>
          <nav>
            {NAV.map((n) => {
              const isActive = active === n.label;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "var(--gate-accent)" : "var(--gate-ink-soft)",
                    borderBottom: isActive ? "2px solid var(--gate-accent)" : "2px solid transparent",
                  }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </Flex>
      </Flex>
    </header>
  );
}

export function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "14px 24px 0",
        fontSize: 13,
        color: "var(--gate-ink-soft)",
      }}
    >
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span style={{ margin: "0 8px", opacity: 0.5 }}>/</span>}
          {it}
        </span>
      ))}
    </div>
  );
}
