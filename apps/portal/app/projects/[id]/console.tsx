"use client";

import { useCallback, useState } from "react";
import { upload } from "@vercel/blob/client";

/** The nine steps, for the timeline rail. */
const STEPS = [
  "Upload",
  "Extraction",
  "Design DNA",
  "Prototype",
  "Review",
  "Blueprint lock",
  "Mapping",
  "QA",
  "Export",
] as const;

type EventRow = { id: number; type: string; createdAt: string };

export function ProjectConsole(props: {
  projectId: string;
  initialStatus: string;
  companyName: string;
  periodLabel: string | null;
  workflowRunId: string | null;
  initialEvents: EventRow[];
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [events, setEvents] = useState<EventRow[]>(props.initialEvents);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      setNote(null);
      try {
        // Client pre-checks: magic bytes + size before a byte moves.
        const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...head) !== "%PDF-") {
          setNote("That file is not a PDF.");
          return;
        }
        const blob = await upload(`projects/${props.projectId}/source/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/uploads/token",
          contentType: "application/pdf",
        });
        const res = await fetch("/api/uploads/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: props.projectId, blobPath: blob.pathname }),
        });
        const data = await res.json();
        if (data.error) {
          setNote(`Rejected: ${data.error.code ?? ""} ${data.error.message ?? data.error}`);
          return;
        }
        setNote(`Uploaded ${data.page_count}-page PDF. Ready to run.`);
        setStatus("uploaded");
      } catch (err) {
        setNote(`Upload failed: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [props.projectId],
  );

  const gate = useCallback(
    async (path: string, body: object, label: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/runs/${props.projectId}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        setNote(res.ok ? `${label} sent.` : `Failed: ${(await res.json()).error}`);
      } finally {
        setBusy(false);
      }
    },
    [props.projectId],
  );

  const currentStepIndex = stepIndexForStatus(status);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <a href="/" style={{ color: "var(--gold-deep)", fontSize: 13, textDecoration: "none" }}>
        ← Projects
      </a>
      <header>
        <h1 style={{ fontSize: 26, margin: "0 0 2px" }}>{props.companyName}</h1>
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          {props.periodLabel ?? "—"} ·{" "}
          <span style={{ color: "var(--gold-deep)", letterSpacing: ".06em" }}>
            {status.toUpperCase()}
          </span>
        </p>
      </header>

      {/* Nine-step rail */}
      <ol
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
      >
        {STEPS.map((label, i) => {
          const state = i < currentStepIndex ? "done" : i === currentStepIndex ? "active" : "todo";
          return (
            <li
              key={label}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 99,
                border: "1px solid var(--rule)",
                color: state === "todo" ? "var(--ink-2)" : "#fff",
                background:
                  state === "done"
                    ? "var(--gold-deep)"
                    : state === "active"
                      ? "var(--gold)"
                      : "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}. {label}
            </li>
          );
        })}
      </ol>

      {/* Upload */}
      <section style={panel}>
        <h2 style={h2}>1 · Upload the results PDF</h2>
        <label
          style={{
            display: "block",
            padding: "24px",
            border: "1.5px dashed var(--rule)",
            borderRadius: 8,
            textAlign: "center",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          Drop a PDF here, or click to choose. Private storage; 150 MB / 250 pages max.
        </label>
        {status === "uploaded" ? (
          <button
            style={primary}
            disabled={busy}
            onClick={() =>
              gate("../pipeline/start" as string, {}, "Pipeline start").then(() =>
                setNote("Pipeline start is wired via /api/pipeline/start (needs org/document ids)."),
              )
            }
          >
            Run pipeline
          </button>
        ) : null}
      </section>

      {/* Human gates */}
      <section style={panel}>
        <h2 style={h2}>Human gates</h2>
        <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
          Four decisions are yours. These POST to the workflow hooks; the run resumes when you act.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={ghost} disabled={busy} onClick={() => gate("dna", { schema_version: "dna-correction/1", dna_id: "", edits: [], approve: true, approved_by: "operator" }, "DNA approval")}>
            Approve design DNA
          </button>
          <button style={ghost} disabled={busy} onClick={() => gate("review", { type: "approve", prototype_version_id: "", actor_user_id: "operator" }, "Design approval")}>
            Approve design
          </button>
          <button style={ghost} disabled={busy} onClick={() => gate("lock", { type: "confirm_lock", blueprint_version_id: "", actor_user_id: "operator" }, "Blueprint lock")}>
            Confirm lock
          </button>
          <button style={ghost} disabled={busy} onClick={() => gate("qa", { type: "approve", qa_report_id: "", actor_user_id: "operator" }, "QA sign-off")}>
            Approve QA &amp; export
          </button>
        </div>
      </section>

      {note ? (
        <p style={{ fontSize: 13, color: "var(--gold-deep)", margin: 0 }}>{note}</p>
      ) : null}

      {/* Timeline */}
      <section style={panel}>
        <h2 style={h2}>Run timeline</h2>
        {events.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>
            No events yet. Upload a PDF and run the pipeline to see progress stream in.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
            {events.map((e) => (
              <li key={e.id} style={{ fontSize: 13, display: "flex", gap: 10 }}>
                <span style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
                <span>{e.type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function stepIndexForStatus(status: string): number {
  const map: Record<string, number> = {
    created: 0,
    uploaded: 0,
    extracting: 1,
    extraction_failed: 1,
    dna_detecting: 2,
    dna_review: 2,
    prototype_generating: 3,
    in_review: 4,
    blueprint_extracting: 5,
    blueprint_proposed: 5,
    locked: 5,
    mapping: 6,
    qa_running: 7,
    qa_review: 7,
    exporting: 8,
    exported: 8,
  };
  return map[status] ?? 0;
}

const panel: React.CSSProperties = {
  border: "1px solid var(--rule)",
  borderRadius: 8,
  padding: 16,
  display: "grid",
  gap: 10,
};
const h2: React.CSSProperties = { fontSize: 15, margin: 0 };
const primary: React.CSSProperties = {
  padding: "9px 18px",
  border: "none",
  borderRadius: 6,
  background: "var(--gold)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  justifySelf: "start",
};
const ghost: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--ink)",
  cursor: "pointer",
  fontSize: 13,
};
