"use client";

import { useCallback, useEffect, useState } from "react";
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
  orgId: string;
  documentId: string | null;
  initialStatus: string;
  companyName: string;
  periodLabel: string | null;
  workflowRunId: string | null;
  initialEvents: EventRow[];
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [documentId, setDocumentId] = useState<string | null>(props.documentId);
  const [events, setEvents] = useState<EventRow[]>(props.initialEvents);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${props.projectId}/events`);
      if (!res.ok) return;
      const data = (await res.json()) as { events: EventRow[]; status?: string; documentId?: string | null };
      setEvents(data.events);
      if (data.status) setStatus(data.status);
      if (data.documentId) setDocumentId(data.documentId);
    } catch {
      /* ignore poll errors */
    }
  }, [props.projectId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshEvents();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshEvents]);

  const onUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      setNote(null);
      try {
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
        if (data.document_id) setDocumentId(data.document_id);
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

  const startPipeline = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      if (!documentId) {
        setNote("Upload a PDF before starting the pipeline.");
        return;
      }
      if (!props.orgId) {
        setNote("Project is missing an org id — recreate the project.");
        return;
      }
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: props.projectId,
          orgId: props.orgId,
          documentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(`Pipeline start failed: ${data.error ?? res.statusText}`);
        return;
      }
      setStatus("extracting");
      setNote(`Pipeline started (run ${data.runId}). Waiting on extraction…`);
      void refreshEvents();
    } catch (err) {
      setNote(`Pipeline start failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [documentId, props.orgId, props.projectId, refreshEvents]);

  const gate = useCallback(
    async (path: string, body: object, label: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/runs/${props.projectId}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        setNote(res.ok ? `${label} sent.` : `Failed: ${data.error ?? res.statusText}`);
        void refreshEvents();
      } finally {
        setBusy(false);
      }
    },
    [props.projectId, refreshEvents],
  );

  const currentStepIndex = stepIndexForStatus(status);
  const canRun = status === "uploaded" && !!documentId;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <a href="/" style={{ color: "var(--accent-strong)", fontSize: 13, textDecoration: "none" }}>
        ← Projects
      </a>
      <header>
        <h1 style={{ fontSize: 26, margin: "0 0 2px" }}>{props.companyName}</h1>
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          {props.periodLabel ?? "—"} ·{" "}
          <span style={{ color: "var(--accent-strong)", letterSpacing: ".06em" }}>
            {status.toUpperCase()}
          </span>
        </p>
      </header>

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
                    ? "var(--accent-strong)"
                    : state === "active"
                      ? "var(--accent)"
                      : "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}. {label}
            </li>
          );
        })}
      </ol>

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
        {canRun ? (
          <button style={primary} disabled={busy} onClick={() => void startPipeline()}>
            Run pipeline
          </button>
        ) : null}
      </section>

      <section style={panel}>
        <h2 style={h2}>Human gates</h2>
        <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
          Four decisions are yours. Server resolves the current prototype / blueprint / QA IDs.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={ghost}
            disabled={busy}
            onClick={() =>
              void gate(
                "dna",
                {
                  schema_version: "dna-correction/1",
                  dna_id: "",
                  edits: [],
                  approve: true,
                  approved_by: "operator",
                },
                "DNA approval",
              )
            }
          >
            Approve design DNA
          </button>
          <button
            style={ghost}
            disabled={busy}
            onClick={() =>
              void gate(
                "review",
                { type: "approve", prototype_version_id: "", actor_user_id: "operator" },
                "Design approval",
              )
            }
          >
            Approve design
          </button>
          <button
            style={ghost}
            disabled={busy}
            onClick={() =>
              void gate(
                "lock",
                { type: "confirm_lock", blueprint_version_id: "", actor_user_id: "operator" },
                "Blueprint lock",
              )
            }
          >
            Confirm lock
          </button>
          <button
            style={ghost}
            disabled={busy}
            onClick={() =>
              void gate(
                "qa",
                { type: "approve", qa_report_id: "", actor_user_id: "operator" },
                "QA sign-off",
              )
            }
          >
            Approve QA &amp; export
          </button>
        </div>
      </section>

      {note ? (
        <p style={{ fontSize: 13, color: "var(--accent-strong)", margin: 0 }}>{note}</p>
      ) : null}

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
  background: "var(--accent)",
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
