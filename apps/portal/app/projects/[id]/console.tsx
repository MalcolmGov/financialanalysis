"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type ExtractionProgress = {
  jobId: string;
  status: string;
  pagesDone: number;
  totalPages: number | null;
  error?: string | null;
};

type DnaSummary = {
  dnaId: string | null;
  revision: number;
  confidence: number | null;
  flags: { path: string; reason: string; confidence: number }[];
  theme: { mode?: string; rationale?: string };
  toneWords: string[];
  type: {
    heading: string | null;
    body: string | null;
    headingTreatment: { color?: string; case?: string; weight?: number } | null;
    webBasePx: number | null;
    ratio: number | null;
  };
  roles: { role: string; hex: string; name: string }[];
  measured: { hex: string; name: string }[];
  tableStyle: {
    headerBg: string | null;
    headerText: string | null;
    shading: string | null;
    grid: string | null;
  };
  componentIds: string[];
  blobPath: string;
};

/** Docling on CPU is slow; warm-up + ~25–40s/page is a realistic operator guide. */
function estimateExtractionSeconds(pageCount: number | null): number {
  const pages = Math.max(1, pageCount ?? 10);
  return Math.min(45 * 60, Math.max(2 * 60, 75 + pages * 30));
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function ProjectConsole(props: {
  projectId: string;
  orgId: string;
  documentId: string | null;
  initialStatus: string;
  initialPageCount: number | null;
  initialRunStartedAt: string | null;
  companyName: string;
  periodLabel: string | null;
  workflowRunId: string | null;
  initialEvents: EventRow[];
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [documentId, setDocumentId] = useState<string | null>(props.documentId);
  const [pageCount, setPageCount] = useState<number | null>(props.initialPageCount);
  const [events, setEvents] = useState<EventRow[]>(props.initialEvents);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<string | null>(props.initialRunStartedAt);
  const [extraction, setExtraction] = useState<ExtractionProgress | null>(null);
  const [qaVerdict, setQaVerdict] = useState<"pass" | "fail" | null>(null);
  const [exportReady, setExportReady] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [forceRegen, setForceRegen] = useState(false);
  const [dna, setDna] = useState<DnaSummary | null>(null);
  const [dnaError, setDnaError] = useState<string | null>(null);
  const [prototype, setPrototype] = useState<{
    versionId: string;
    versionNumber: number;
    refinementMode: string;
    promptText: string | null;
    previewUrl: string;
    sizeBytes: number | null;
  } | null>(null);
  const [prototypeError, setPrototypeError] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | "full">(1280);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "in_review" && status !== "blueprint_proposed") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${props.projectId}/prototype`);
        const data = (await res.json().catch(() => ({}))) as {
          versionId?: string;
          versionNumber?: number;
          refinementMode?: string;
          promptText?: string | null;
          previewUrl?: string;
          sizeBytes?: number | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.previewUrl || !data.versionId) {
          setPrototype(null);
          setPrototypeError(data.error ?? res.statusText);
          return;
        }
        setPrototype({
          versionId: data.versionId,
          versionNumber: data.versionNumber ?? 1,
          refinementMode: data.refinementMode ?? "initial",
          promptText: data.promptText ?? null,
          previewUrl: data.previewUrl,
          sizeBytes: data.sizeBytes ?? null,
        });
        setPrototypeError(null);
      } catch (err) {
        if (!cancelled) {
          setPrototype(null);
          setPrototypeError((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, props.projectId, events.length]);

  useEffect(() => {
    if (status !== "dna_review") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${props.projectId}/dna`);
        const data = (await res.json().catch(() => ({}))) as DnaSummary & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setDna(null);
          setDnaError(data.error ?? res.statusText);
          return;
        }
        setDna(data);
        setDnaError(null);
      } catch (err) {
        if (!cancelled) {
          setDna(null);
          setDnaError((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, props.projectId]);

  const refreshEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${props.projectId}/events`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        events: EventRow[];
        status?: string;
        documentId?: string | null;
        pageCount?: number | null;
        runStartedAt?: string | null;
        extraction?: ExtractionProgress | null;
        qaVerdict?: "pass" | "fail" | null;
        exportReady?: boolean;
      };
      setEvents(data.events);
      if (data.status) setStatus(data.status);
      if (data.documentId) setDocumentId(data.documentId);
      if (typeof data.pageCount === "number") setPageCount(data.pageCount);
      if (data.runStartedAt) setRunStartedAt(data.runStartedAt);
      if (data.extraction) {
        setExtraction(data.extraction);
      } else if (data.status === "uploaded" || data.status === "created") {
        setExtraction(null);
      }
      // Drop stale wait/fail banners once the run has moved on.
      if (data.status && data.status !== "extracting" && data.status !== "extraction_failed") {
        setNote((prev) =>
          prev?.startsWith("Extraction failed:") ||
          prev?.startsWith("Pipeline started") ||
          prev?.includes("Waiting on extraction") ||
          prev?.startsWith("DNA approval")
            ? null
            : prev,
        );
      } else if (data.status === "extracting" || data.status === "uploaded" || data.status === "created") {
        setNote((prev) => (prev?.startsWith("Extraction failed:") ? null : prev));
      }
      if (data.qaVerdict === "pass" || data.qaVerdict === "fail" || data.qaVerdict === null) {
        setQaVerdict(data.qaVerdict);
      }
      if (typeof data.exportReady === "boolean") setExportReady(data.exportReady);
    } catch {
      /* ignore poll errors */
    }
  }, [props.projectId]);

  const extracting = status === "extracting";

  useEffect(() => {
    const ms = extracting ? 2000 : 4000;
    const id = window.setInterval(() => {
      void refreshEvents();
    }, ms);
    return () => window.clearInterval(id);
  }, [refreshEvents, extracting]);

  useEffect(() => {
    if (!extracting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [extracting]);

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
        const safeName = file.name.replace(/[^\w.\-()+ ]+/g, "_");
        const pathname = `projects/${props.projectId}/source/${Date.now()}-${safeName}`;
        const blob = await upload(pathname, file, {
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
        if (typeof data.page_count === "number") setPageCount(data.page_count);
        setExtraction(null);
        setRunStartedAt(null);
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

  const startOver = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/reset`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        documentId?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setNote(`Start over failed: ${data.error ?? res.statusText}`);
        return;
      }
      setStatus(data.status ?? "uploaded");
      if (data.documentId !== undefined) setDocumentId(data.documentId);
      setExtraction(null);
      setRunStartedAt(null);
      setEvents([]);
      setQaVerdict(null);
      setExportReady(false);
      setNote(
        data.documentId
          ? "Ready to run again with the current PDF, or upload a new one first."
          : "Upload a PDF to begin.",
      );
    } catch (err) {
      setNote(`Start over failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [props.projectId]);

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
      setRunStartedAt(new Date().toISOString());
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

  const waitStats = useMemo(() => {
    const estimate = estimateExtractionSeconds(pageCount);
    const started = runStartedAt ? Date.parse(runStartedAt) : now;
    const elapsedSec = Math.max(0, Math.floor((now - started) / 1000));
    const remainingSec = Math.max(0, estimate - elapsedSec);
    const pctFromTime = Math.min(0.95, elapsedSec / estimate);
    const totalPages = extraction?.totalPages ?? pageCount;
    const pagesDone = extraction?.pagesDone ?? 0;
    const pctFromPages =
      totalPages && totalPages > 0 ? Math.min(0.99, pagesDone / totalPages) : null;
    const pct = pctFromPages ?? pctFromTime;
    return { estimate, elapsedSec, remainingSec, pct, pagesDone, totalPages, overdue: elapsedSec > estimate };
  }, [pageCount, runStartedAt, now, extraction]);

  const currentStepIndex = stepIndexForStatus(status);
  const canRun =
    (status === "uploaded" || status === "extraction_failed") && !!documentId;

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
        <div
          style={{
            display: "grid",
            gap: 14,
            justifyItems: "center",
            padding: "28px 24px",
            border: "1.5px dashed var(--rule)",
            borderRadius: 8,
            textAlign: "center",
            color: "var(--ink-2)",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (busy) return;
            const f = e.dataTransfer.files?.[0];
            if (f) void onUpload(f);
          }}
        >
          <p style={{ margin: 0, fontSize: 13, maxWidth: 360 }}>
            Drop a PDF here, or choose a file. Private storage; 150 MB / 250 pages max.
          </p>
          <label
            style={{
              ...primary,
              display: "inline-block",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
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
                e.target.value = "";
              }}
            />
            {busy ? "Uploading…" : "Choose PDF"}
          </label>
        </div>
        {canRun ? (
          <button style={primary} disabled={busy} onClick={() => void startPipeline()}>
            Run pipeline
          </button>
        ) : null}
      </section>

      {status === "extraction_failed" ? (
        <section style={panel}>
          <h2 style={h2}>2 · Extraction failed</h2>
          <p style={{ color: "#b91c1c", fontSize: 13, margin: 0 }}>
            {extraction?.error ??
              "The worker could not convert this PDF. Fix the worker and click Run pipeline again."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canRun ? (
              <button style={primary} disabled={busy} onClick={() => void startPipeline()}>
                Retry pipeline
              </button>
            ) : null}
            <button style={ghost} disabled={busy} onClick={() => void startOver()}>
              Start over
            </button>
          </div>
          <p style={{ color: "var(--ink-2)", fontSize: 12, margin: 0 }}>
            Start over clears the failed run so you can upload a new PDF (section 1) or re-run the
            current one after the worker is healthy again.
          </p>
        </section>
      ) : null}

      {status === "prototype_generating" ? (
        <section style={panel} aria-live="polite">
          <h2 style={h2}>4 · Generating prototype</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>
            Claude is building the first interactive HTML prototype from the approved DNA and extracted
            content. This usually takes several minutes — leave this tab open. When it finishes, status
            becomes <strong>IN_REVIEW</strong> and you can refine or approve the design.
          </p>
          <p style={{ color: "var(--accent-strong)", fontSize: 13, margin: 0 }}>
            Nothing to click right now — waiting on generation.
          </p>
        </section>
      ) : null}

      {status === "dna_review" ? (
        <section style={panel}>
          <h2 style={h2}>3 · Review design DNA</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
            This is the measured visual identity from the PDF (palette, type, table treatment). Approve
            only if it looks faithful — the prototype and microsite are constrained by it.
          </p>
          {dnaError ? (
            <p style={{ color: "#b91c1c", fontSize: 13, margin: 0 }}>Could not load DNA: {dnaError}</p>
          ) : null}
          {!dna && !dnaError ? (
            <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>Loading measured DNA…</p>
          ) : null}
          {dna ? (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13 }}>
                <div>
                  <div style={statLabel}>Confidence</div>
                  <div style={statValue}>
                    {dna.confidence != null ? `${Math.round(dna.confidence * 100)}%` : "—"}
                  </div>
                </div>
                <div>
                  <div style={statLabel}>Theme</div>
                  <div style={statValue}>{dna.theme.mode ?? "—"}</div>
                </div>
                <div>
                  <div style={statLabel}>Revision</div>
                  <div style={statValue}>v{dna.revision}</div>
                </div>
              </div>
              {dna.theme.rationale ? (
                <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>{dna.theme.rationale}</p>
              ) : null}
              <div>
                <div style={{ ...statLabel, marginBottom: 8 }}>Palette roles</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {dna.roles.map((r) => (
                    <div key={r.role} style={{ width: 88, fontSize: 11 }}>
                      <div
                        title={r.hex}
                        style={{
                          height: 40,
                          borderRadius: 6,
                          background: r.hex,
                          border: "1px solid var(--rule)",
                          marginBottom: 4,
                        }}
                      />
                      <div style={{ color: "var(--ink)", fontWeight: 600 }}>{r.role}</div>
                      <div style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                        {r.hex}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <div>
                  <span style={{ color: "var(--ink-2)" }}>Heading face · </span>
                  {dna.type.heading ?? "—"}
                </div>
                <div>
                  <span style={{ color: "var(--ink-2)" }}>Body face · </span>
                  {dna.type.body ?? "—"}
                </div>
                {dna.type.headingTreatment ? (
                  <div>
                    <span style={{ color: "var(--ink-2)" }}>Heading treatment · </span>
                    {dna.type.headingTreatment.case ?? "?"} / weight{" "}
                    {dna.type.headingTreatment.weight ?? "?"} / {dna.type.headingTreatment.color ?? "?"}
                  </div>
                ) : null}
                {dna.tableStyle.headerBg ? (
                  <div>
                    <span style={{ color: "var(--ink-2)" }}>Table header · </span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: dna.tableStyle.headerBg,
                        border: "1px solid var(--rule)",
                        verticalAlign: "middle",
                        marginRight: 6,
                      }}
                    />
                    {dna.tableStyle.headerBg} on {dna.tableStyle.headerText ?? "—"}
                    {dna.tableStyle.grid ? ` · ${dna.tableStyle.grid}` : ""}
                  </div>
                ) : null}
                {dna.toneWords.length ? (
                  <div>
                    <span style={{ color: "var(--ink-2)" }}>Tone · </span>
                    {dna.toneWords.join(", ")}
                  </div>
                ) : null}
                {dna.componentIds.length ? (
                  <div>
                    <span style={{ color: "var(--ink-2)" }}>Components · </span>
                    {dna.componentIds.join(", ")}
                  </div>
                ) : null}
              </div>
              {dna.flags.length ? (
                <div>
                  <div style={{ ...statLabel, marginBottom: 6 }}>Confidence flags</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--ink-2)" }}>
                    {dna.flags.slice(0, 8).map((f) => (
                      <li key={`${f.path}-${f.reason}`}>
                        {f.path}: {f.reason} ({Math.round(f.confidence * 100)}%)
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <a
                href={`/api/blob/${dna.blobPath}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: "var(--accent-strong)" }}
              >
                Open full DNA JSON
              </a>
            </div>
          ) : null}
          <button
            style={{ ...primary, marginTop: 8 }}
            disabled={busy || (!dna && !dnaError)}
            onClick={() =>
              void gate(
                "dna",
                {
                  schema_version: "dna-correction/1",
                  dna_id: dna?.dnaId ?? "",
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
        </section>
      ) : null}

      {extracting ? (
        <section style={panel} aria-live="polite">
          <h2 style={h2}>2 · Extraction in progress</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>
            Docling is reading the PDF on the worker. First convert after deploy can take longer
            while models load; page counts update after the document convert finishes. Typically a
            few minutes for a {pageCount ?? "multi"}-page results pack.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginTop: 4,
            }}
          >
            <div>
              <div style={statLabel}>Elapsed</div>
              <div style={statValue}>{formatDuration(waitStats.elapsedSec)}</div>
            </div>
            <div>
              <div style={statLabel}>
                {waitStats.overdue ? "Past estimate" : "Est. remaining"}
              </div>
              <div style={statValue}>
                {waitStats.overdue
                  ? `+${formatDuration(waitStats.elapsedSec - waitStats.estimate)}`
                  : formatDuration(waitStats.remainingSec)}
              </div>
            </div>
            <div>
              <div style={statLabel}>Pages</div>
              <div style={statValue}>
                {waitStats.totalPages != null
                  ? `${waitStats.pagesDone} / ${waitStats.totalPages}`
                  : pageCount != null
                    ? `0 / ${pageCount}`
                    : "—"}
              </div>
            </div>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 99,
              background: "var(--rule)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(waitStats.pct * 100)}%`,
                background: "var(--accent)",
                transition: "width 0.6s ease",
              }}
            />
          </div>
          <p style={{ color: "var(--ink-2)", fontSize: 12, margin: 0 }}>
            {waitStats.overdue
              ? "Still working — large or OCR-heavy PDFs can overrun the estimate. Leave this tab open."
              : `Rough guide ~${formatDuration(waitStats.estimate)} for this document. Countdown is an estimate, not a hard deadline.`}
          </p>
        </section>
      ) : null}

      {status === "in_review" || status === "blueprint_proposed" ? (
        <section style={panel}>
          <h2 style={h2}>5 · Prototype preview</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
            Interactive HTML generated from the approved DNA. Compare it to the source PDF look-and-feel,
            then refine or approve.
          </p>
          {prototypeError ? (
            <p style={{ color: "#b91c1c", fontSize: 13, margin: 0 }}>
              Could not load prototype: {prototypeError}
            </p>
          ) : null}
          {!prototype && !prototypeError ? (
            <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>Loading prototype…</p>
          ) : null}
          {prototype ? (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  fontSize: 13,
                }}
              >
                <span>
                  v{prototype.versionNumber} · {prototype.refinementMode}
                  {prototype.sizeBytes != null
                    ? ` · ${Math.round(prototype.sizeBytes / 1024)} KB`
                    : ""}
                </span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  {(
                    [
                      [390, "Phone"],
                      [768, "Tablet"],
                      [1280, "Desktop"],
                      ["full", "Full"],
                    ] as const
                  ).map(([w, label]) => (
                    <button
                      key={label}
                      type="button"
                      style={{
                        ...ghost,
                        padding: "6px 10px",
                        fontSize: 12,
                        background: previewWidth === w ? "var(--accent)" : "transparent",
                        color: previewWidth === w ? "#fff" : "var(--ink-2)",
                      }}
                      onClick={() => setPreviewWidth(w)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <a
                  href={prototype.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--accent-strong)" }}
                >
                  Open in new tab
                </a>
              </div>
              <div
                style={{
                  width: "100%",
                  overflow: "auto",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  background: "#111",
                }}
              >
                <iframe
                  title={`Prototype v${prototype.versionNumber}`}
                  src={prototype.previewUrl}
                  sandbox="allow-scripts"
                  style={{
                    display: "block",
                    width: previewWidth === "full" ? "100%" : previewWidth,
                    maxWidth: "100%",
                    height: 720,
                    margin: "0 auto",
                    border: 0,
                    background: "#fff",
                  }}
                />
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {status === "in_review" ? (
        <section style={panel}>
          <h2 style={h2}>5 · Refine prototype</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
            Patch-first edits against the current prototype. Numbers cannot change — describe layout,
            styling, or non-numeric copy only. Approve design when the head version looks right.
          </p>
          <textarea
            value={refinePrompt}
            onChange={(e) => setRefinePrompt(e.target.value)}
            placeholder="e.g. Make the masthead tighter and move KPIs into a single horizontal band."
            rows={3}
            disabled={busy}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              font: "inherit",
              fontSize: 13,
              resize: "vertical",
              background: "var(--paper)",
              color: "var(--ink)",
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 8,
            }}
          >
            <input
              type="checkbox"
              checked={forceRegen}
              disabled={busy}
              onChange={(e) => setForceRegen(e.target.checked)}
            />
            Force full regen (slow / expensive — only if patch cannot express the change)
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={primary}
              disabled={busy || !refinePrompt.trim()}
              onClick={() => {
                const prompt = refinePrompt.trim();
                if (!prompt) return;
                void gate(
                  "review",
                  {
                    type: "refine",
                    prompt,
                    base_version_id: "",
                    force_mode: forceRegen ? "regen" : null,
                    actor_user_id: "operator",
                  },
                  forceRegen ? "Full regen" : "Refine",
                ).then(() => setRefinePrompt(""));
              }}
            >
              {forceRegen ? "Rebuild prototype" : "Send refine"}
            </button>
          </div>
        </section>
      ) : null}

      <section style={panel}>
        <h2 style={h2}>Human gates</h2>
        <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
          Four decisions are yours. Server resolves the current prototype / blueprint / QA IDs.
          {qaVerdict ? (
            <>
              {" "}
              Latest QA: <strong style={{ color: qaVerdict === "pass" ? "var(--accent-strong)" : "#b91c1c" }}>{qaVerdict}</strong>
              {qaVerdict === "fail" ? " — export approve is blocked until gates pass." : null}
              {qaVerdict === "pass"
                ? " — Gate A/B + lint only; PDF cross-check, arithmetic advisory, and Playwright/axe are not run yet."
                : null}
            </>
          ) : null}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={status === "dna_review" ? primary : ghost}
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
            style={status === "in_review" ? primary : ghost}
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
            disabled={busy || qaVerdict === "fail" || status === "exported"}
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
          <button
            style={ghost}
            disabled={busy || status !== "qa_review"}
            onClick={() =>
              void gate(
                "qa",
                {
                  type: "change_request",
                  qa_report_id: "",
                  actor_user_id: "operator",
                  reason: "Operator requested changes after QA",
                  scope: "mapping",
                },
                "QA change request",
              )
            }
          >
            Request QA changes
          </button>
        </div>
      </section>

      {status === "exported" || exportReady ? (
        <section style={panel}>
          <h2 style={h2}>9 · Export ready</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>
            Static HTML microsite zip (relative links, zero external requests). Download and host on any static server.
          </p>
          <a
            href={`/api/projects/${props.projectId}/export`}
            style={{ ...primary, display: "inline-block", textDecoration: "none", textAlign: "center" }}
          >
            Download microsite zip
          </a>
        </section>
      ) : null}

      {note ? (
        <p style={{ fontSize: 13, color: "var(--accent-strong)", margin: 0 }}>{note}</p>
      ) : null}

      <section style={panel}>
        <h2 style={h2}>Run timeline</h2>
        {events.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0 }}>
            {extracting
              ? "Extraction is running. Timeline events will appear as steps complete."
              : "No events yet. Upload a PDF and run the pipeline to see progress stream in."}
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
const statLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--ink-2)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
};
const statValue: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
};
