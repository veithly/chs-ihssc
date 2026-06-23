import type { Metadata, Viewport } from "next";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "医保可信数据通行 Agent",
  description:
    "弄脏一行医保数据，看 Agent 决定这批数据能否通行。面向医保数据中心 / 可信数据空间运营人员的发布通行工作台。",
  applicationName: "医保可信数据通行 Agent",
  icons: {
    icon: "/brand/logomark.svg",
  },
  openGraph: {
    title: "医保可信数据通行 Agent",
    description: "弄脏一行医保数据，看 Agent 决定这批数据能否通行。",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f6feb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Theme
          accentColor="blue"
          grayColor="slate"
          radius="medium"
          scaling="100%"
          panelBackground="solid"
        >
          {children}
        </Theme>
      </body>
    </html>
  );
}
