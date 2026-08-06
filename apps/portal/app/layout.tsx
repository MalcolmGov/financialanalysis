import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Results Studio",
  description: "PDF → verified interactive financial-results microsite",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "3px solid var(--gold)",
            padding: "18px 28px",
            display: "flex",
            alignItems: "baseline",
            gap: 14,
          }}
        >
          <a href="/" style={{ textDecoration: "none", color: "var(--ink)" }}>
            <strong style={{ fontSize: 18 }}>Results Studio</strong>
          </a>
          <span style={{ fontSize: 12, color: "var(--ink-2)", letterSpacing: ".08em" }}>
            PDF → VERIFIED INTERACTIVE RESULTS
          </span>
        </header>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px" }}>{children}</main>
      </body>
    </html>
  );
}
