import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import { ShellNav } from "./shell-nav";
import { classifyHost, hostOperatorCopy } from "../lib/runtime-host";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Results Studio",
  description: "PDF → verified interactive financial-results microsite",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const hostCopy = hostOperatorCopy(classifyHost(host));

  return (
    <html lang="en" data-theme="dark" className={jakarta.variable}>
      <body className={jakarta.className}>
        <div className="rs-shell">
          <header className="rs-header">
            <a href="/" className="rs-brand">
              <span className="rs-brand-mark">Results Studio</span>
              <span className="rs-brand-sub">Operator console</span>
              <span className="rs-host-badge" title={hostCopy.hint}>
                {hostCopy.label}
              </span>
            </a>
            <ShellNav />
          </header>
          <main className="rs-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
