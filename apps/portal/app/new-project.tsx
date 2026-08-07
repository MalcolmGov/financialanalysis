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

  return (
    <section className="rs-create">
      <div>
        <p className="rs-kicker">New project</p>
        <p className="rs-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          Company and reporting period — then upload the source PDF in the console.
        </p>
      </div>
      <div className="rs-create-row">
        <input
          className="rs-field"
          placeholder="Company name (e.g. DRDGOLD Limited)"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <input
          className="rs-field"
          placeholder="Period (e.g. HY1 FY2026)"
          value={periodLabel}
          onChange={(e) => setPeriodLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button
          type="button"
          className="rs-btn rs-btn--primary"
          onClick={() => void create()}
          disabled={busy || !companyName.trim()}
        >
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </section>
  );
}
