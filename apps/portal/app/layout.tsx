import type { Metadata } from "next";
import { Public_Sans, Spectral } from "next/font/google";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-spectral",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Results Studio",
  description: "PDF → verified interactive financial-results microsite",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${spectral.variable} ${publicSans.variable}`}>
      <body className={publicSans.className}>
        <div className="rs-shell">
          <header className="rs-header">
            <a href="/" className="rs-brand">
              <span className="rs-brand-mark">Results Studio</span>
              <span className="rs-brand-sub">Operator console</span>
            </a>
            <span className="rs-header-meta">PDF → verified interactive results</span>
          </header>
          <main className="rs-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
