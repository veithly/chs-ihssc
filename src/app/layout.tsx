import type { Metadata, Viewport } from "next";
import { Theme } from "@radix-ui/themes";
import { DesktopPet } from "@/components/DesktopPet";
import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "价序",
  description:
    "面向医保价格招采与价格监测人员的对话式工作台：上传表格或连接数据源，直接交代价格治理任务。",
  applicationName: "价序",
  icons: {
    icon: "/brand/logomark.svg",
  },
  openGraph: {
    title: "价序",
    description: "把表格或数据源交给价序，直接说你要完成的价格治理工作。",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1623",
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
          accentColor="indigo"
          grayColor="slate"
          radius="medium"
          scaling="100%"
          panelBackground="solid"
        >
          {children}
          <DesktopPet />
        </Theme>
      </body>
    </html>
  );
}
