import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import { ShellNav } from "./shell-nav";
import "./globals.css";

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-instrument",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Results Studio",
  description: "PDF → verified interactive financial-results microsite",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${instrument.variable} ${manrope.variable}`}>
      <body className={manrope.className}>
        <div className="rs-shell">
          <header className="rs-header">
            <a href="/" className="rs-brand">
              <span className="rs-brand-mark">Results Studio</span>
              <span className="rs-brand-sub">Operator</span>
            </a>
            <ShellNav />
          </header>
          <main className="rs-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
