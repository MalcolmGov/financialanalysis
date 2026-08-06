"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewProject() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!companyName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, periodLabel }),
      });
      const data = await res.json();
      if (data.project?.id) router.push(`/projects/${data.project.id}`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    padding: "9px 12px",
    border: "1px solid var(--rule)",
    borderRadius: 6,
    background: "transparent",
    color: "var(--ink)",
  };

  return (
    <section
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        padding: 16,
        border: "1px solid var(--rule)",
        borderRadius: 8,
      }}
    >
      <input
        style={{ ...field, flex: "2 1 240px" }}
        placeholder="Company name (e.g. DRDGOLD Limited)"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
      />
      <input
        style={{ ...field, flex: "1 1 160px" }}
        placeholder="Period (e.g. HY1 FY2026)"
        value={periodLabel}
        onChange={(e) => setPeriodLabel(e.target.value)}
      />
      <button
        onClick={create}
        disabled={busy || !companyName.trim()}
        style={{
          padding: "9px 18px",
          border: "none",
          borderRadius: 6,
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Creating…" : "New project"}
      </button>
    </section>
  );
}
