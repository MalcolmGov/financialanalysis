"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { upload } from "@vercel/blob/client";

/** Prototype-as-product rail — no blueprint / mapping / QA gates. */
const STEPS = ["Upload", "Extraction", "Design DNA", "Prototype", "Export"] as const;

type EventRow = { id: number; type: string; createdAt: string };

type BusyWaitKind = "extracting" | "dna_detecting" | "prototype_generating";

/** Soft typical durations for operator wait copy (not hard SLAs). */
const BUSY_ETA_SECONDS: Record<BusyWaitKind, number> = {
  extracting: Math.round(2.5 * 60),
  dna_detecting: Math.round(1.5 * 60),
  /** Shell-gen + deterministic table inject — typically ~3–6 min. */
  prototype_generating: Math.round(4.5 * 60),
}

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

function isBusyWaitStatus(status: string): status is BusyWaitKind {
  return (
    status === "extracting" ||
    status === "dna_detecting" ||
    status === "prototype_generating"
  );
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Soft remaining copy — never a hard 0:00 countdown while still working. */
function formatSoftRemaining(remainingSec: number, overdue: boolean): string {
  if (overdue) return "Taking longer than usual…";
  if (remainingSec <= 75) return "About 1 min left";
  return `About ${Math.ceil(remainingSec / 60)} min left`;
}

/** Ease toward ~90%; hold there until the step completes (panel unmounts). */
function softProgressPct(
  elapsedSec: number,
  estimateSec: number,
  pagePct: number | null,
): number {
  const timePct = Math.min(0.9, (elapsedSec / Math.max(1, estimateSec)) * 0.9);
  if (pagePct == null) return timePct;
  return Math.min(0.9, Math.max(timePct, pagePct * 0.9));
}

function resolveBusyStartedMs(opts: {
  kind: BusyWaitKind;
  now: number;
  events: EventRow[];
  runStartedAt: string | null;
  statusUpdatedAt: string | null;
  clientStartedAt: number | null;
}): number {
  const { kind, now, events, runStartedAt, statusUpdatedAt, clientStartedAt } = opts;
  if (kind === "extracting") {
    const awaiting = events.find((e) => e.type === "awaiting.extraction")?.createdAt;
    if (awaiting) {
      const t = Date.parse(awaiting);
      if (!Number.isNaN(t)) return t;
    }
    if (runStartedAt) {
      const t = Date.parse(runStartedAt);
      if (!Number.isNaN(t)) return t;
    }
  }
  // Prefer client observation of the status transition (approve click / poll flip).
  if (clientStartedAt != null) return clientStartedAt;
  // Server updatedAt approximates when this status was entered (reload mid-wait).
  // Do not fall back to runStartedAt here — that includes prior pipeline steps.
  if (statusUpdatedAt) {
    const t = Date.parse(statusUpdatedAt);
    if (!Number.isNaN(t)) return t;
  }
  return now;
}

function nextActionForStatus(status: string, hasDocument: boolean): {
  title: string;
  hint: string;
  waiting?: boolean;
} {
  switch (status) {
    case "created":
      return {
        title: "Upload the results PDF",
        hint: "Drop the source pack below to begin. Private storage; 150 MB / 250 pages max.",
      };
    case "uploaded":
      return {
        title: "Run the pipeline",
        hint: hasDocument
          ? "Extraction will read the PDF, then pause for design DNA review."
          : "Upload a PDF before starting.",
      };
    case "extracting":
      return {
        title: "Extracting document",
        hint: "Docling is reading the PDF on the worker. Usually about 2–3 minutes — leave this tab open.",
        waiting: true,
      };
    case "extraction_failed":
      return {
        title: "Retry extraction",
        hint: "Fix the worker if needed, then retry — or start over with a new PDF.",
      };
    case "dna_detecting":
      return {
        title: "Measuring design DNA",
        hint: "Palette, type, and table treatment are being derived from the PDF. Usually about 1–2 minutes.",
        waiting: true,
      };
    case "dna_review":
      return {
        title: "Approve design DNA",
        hint: "Confirm the measured identity looks faithful before prototype generation.",
      };
    case "prototype_generating":
      return {
        title: "Generating prototype",
        hint: "Building the IR layout shell from approved DNA, then injecting full statements. Usually 3–6 minutes.",
        waiting: true,
      };
    case "in_review":
    case "blueprint_proposed":
      return {
        title: "Review & refine prototype",
        hint: "Compare to the source look-and-feel, refine if needed, then approve & export.",
      };
    case "exporting":
      return {
        title: "Packaging export",
        hint: "Building the multi-page Results Studio site and zipping it. Download appears when status is exported.",
        waiting: true,
      };
    case "exported":
      return {
        title: "Download microsite",
        hint: "The zip is a multi-page static site — open index.html locally to navigate pages.",
      };
    default:
      return {
        title: "Continue the run",
        hint: `Current status: ${status.replaceAll("_", " ")}.`,
      };
  }
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
  const [exportReady, setExportReady] = useState(false);
  const [exportInfo, setExportInfo] = useState<{
    mode?: string;
    fileCount?: number;
    files?: string[];
    entrypoint?: string;
  } | null>(null);
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
  /** Client timestamp when we observed entering a busy wait status. */
  const [clientBusyStartedAt, setClientBusyStartedAt] = useState<number | null>(null);
  /** Server project.updatedAt — fallback when reloading mid-wait. */
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<string | null>(null);
  const prevStatusRef = useRef(props.initialStatus);

  useEffect(() => {
    document.documentElement.style.setProperty("--max", "1240px");
    return () => {
      document.documentElement.style.removeProperty("--max");
    };
  }, []);

  useEffect(() => {
    if (status === prevStatusRef.current) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (isBusyWaitStatus(status) && status !== prev) {
      setClientBusyStartedAt(Date.now());
    } else if (!isBusyWaitStatus(status)) {
      setClientBusyStartedAt(null);
    }
  }, [status]);

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
        statusUpdatedAt?: string | null;
        extraction?: ExtractionProgress | null;
        exportReady?: boolean;
        exportInfo?: {
          mode?: string;
          fileCount?: number;
          files?: string[];
          entrypoint?: string;
        } | null;
      };
      setEvents(data.events);
      if (data.status) setStatus(data.status);
      if (data.documentId) setDocumentId(data.documentId);
      if (typeof data.pageCount === "number") setPageCount(data.pageCount);
      if (data.runStartedAt) setRunStartedAt(data.runStartedAt);
      if (data.statusUpdatedAt) setStatusUpdatedAt(data.statusUpdatedAt);
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
      if (typeof data.exportReady === "boolean") setExportReady(data.exportReady);
      if (data.exportInfo !== undefined) setExportInfo(data.exportInfo ?? null);
    } catch {
      /* ignore poll errors */
    }
  }, [props.projectId]);

  const extracting = status === "extracting";
  const waitingBusy = isBusyWaitStatus(status);

  useEffect(() => {
    const ms = waitingBusy ? 2000 : 4000;
    const id = window.setInterval(() => {
      void refreshEvents();
    }, ms);
    return () => window.clearInterval(id);
  }, [refreshEvents, waitingBusy]);

  useEffect(() => {
    if (!waitingBusy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [waitingBusy]);

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
      setExportReady(false);
      setDna(null);
      setDnaError(null);
      setPrototype(null);
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
    async (path: string, body: object, label: string): Promise<boolean> => {
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
        return res.ok;
      } finally {
        setBusy(false);
      }
    },
    [props.projectId, refreshEvents],
  );

  const busyKind = isBusyWaitStatus(status) ? status : null;

  const waitStats = useMemo(() => {
    if (!busyKind) return null;
    const estimate = BUSY_ETA_SECONDS[busyKind];
    const started = resolveBusyStartedMs({
      kind: busyKind,
      now,
      events,
      runStartedAt,
      statusUpdatedAt,
      clientStartedAt: clientBusyStartedAt,
    });
    const elapsedSec = Math.max(0, Math.floor((now - started) / 1000));
    const remainingSec = Math.max(0, estimate - elapsedSec);
    const overdue = elapsedSec > estimate;
    const totalPages = extraction?.totalPages ?? pageCount;
    const pagesDone = extraction?.pagesDone ?? 0;
    const pagePct =
      busyKind === "extracting" && totalPages != null && totalPages > 0
        ? Math.min(1, pagesDone / totalPages)
        : null;
    const pct = softProgressPct(elapsedSec, estimate, pagePct);
    return {
      kind: busyKind,
      estimate,
      elapsedSec,
      remainingSec,
      pct,
      pagesDone,
      totalPages,
      overdue,
    };
  }, [
    busyKind,
    now,
    events,
    runStartedAt,
    statusUpdatedAt,
    clientBusyStartedAt,
    extraction,
    pageCount,
  ]);

  const currentStepIndex = stepIndexForStatus(status);
  const canRun =
    (status === "uploaded" || status === "extraction_failed") && !!documentId;
  // Anything past a parked project can be abandoned and restarted.
  const canStartOver = status !== "created" && status !== "uploaded";
  const showUpload =
    status === "created" ||
    status === "uploaded" ||
    status === "extraction_failed" ||
    currentStepIndex === 0;
  const next = nextActionForStatus(status, !!documentId);

  async function approveDna() {
    const ok = await gate(
      "dna",
      {
        schema_version: "dna-correction/1",
        dna_id: dna?.dnaId ?? "",
        edits: [],
        approve: true,
        approved_by: "operator",
      },
      "DNA approval",
    );
    if (ok) {
      setStatus("prototype_generating");
      setClientBusyStartedAt(Date.now());
    }
  }

  async function approveExport() {
    await gate(
      "review",
      { type: "approve", prototype_version_id: "", actor_user_id: "operator" },
      "Approve & export",
    );
  }

  const progressPct =
    currentStepIndex <= 0 ? 0 : Math.min(100, (currentStepIndex / (STEPS.length - 1)) * 100);
  const noteDanger =
    !!note &&
    (note.startsWith("Failed") ||
      note.startsWith("Rejected") ||
      note.startsWith("Upload failed") ||
      note.startsWith("That file") ||
      note.startsWith("Start over failed") ||
      note.startsWith("Pipeline start failed") ||
      note.startsWith("Extraction failed"));

  return (
    <div className="rs-console">
      <a href="/" className="rs-back">
        ← Projects
      </a>

      <div className="rs-stage">
        <header className="rs-stage-head">
          <div>
            <p className="rs-kicker">Project</p>
            <h1>{props.companyName}</h1>
            <p className="rs-console-sub">
              <span>{props.periodLabel ?? "—"}</span>
              <span aria-hidden="true">·</span>
              <span className="rs-status">
                {(extracting ||
                  status === "prototype_generating" ||
                  status === "dna_detecting" ||
                  status === "exporting") && <span className="rs-live-dot" aria-hidden="true" />}
                {status.replaceAll("_", " ")}
              </span>
              {pageCount != null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="rs-tiny">{pageCount} pages</span>
                </>
              ) : null}
            </p>
          </div>
          {canStartOver ? (
            <button
              type="button"
              className="rs-btn rs-btn--quiet"
              disabled={busy}
              onClick={() => void startOver()}
              title="Detach the current run so you can upload a new PDF or re-run from scratch"
            >
              Start over
            </button>
          ) : null}
        </header>

        <div className="rs-rail-wrap">
          <div className="rs-rail__track" aria-hidden="true">
            <div className="rs-rail__progress" style={{ width: `${progressPct}%` }} />
          </div>
          <ol className="rs-rail" aria-label="Pipeline steps">
            {STEPS.map((label, i) => {
              const state =
                i < currentStepIndex ? "done" : i === currentStepIndex ? "active" : "todo";
              return (
                <li
                  key={label}
                  className={`rs-rail-item${state === "done" ? " rs-rail-item--done" : ""}${state === "active" ? " rs-rail-item--active" : ""}`}
                  aria-current={state === "active" ? "step" : undefined}
                >
                  <span className="rs-rail-item__dot" />
                  <span className="rs-rail-item__label">{label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="rs-directive">
          <div>
            <p className="rs-kicker">{next.waiting ? "In progress" : "Next"}</p>
            <h2>{next.title}</h2>
            <p>{next.hint}</p>
          </div>
          <div className="rs-directive__cta">
            {canRun ? (
              <button
                type="button"
                className="rs-btn rs-btn--primary"
                disabled={busy}
                onClick={() => void startPipeline()}
              >
                {status === "extraction_failed" ? "Retry pipeline" : "Run pipeline"}
              </button>
            ) : null}
            {status === "dna_review" ? (
              <button
                type="button"
                className="rs-btn rs-btn--primary"
                disabled={busy || (!dna && !dnaError)}
                onClick={() => void approveDna()}
              >
                Approve design DNA
              </button>
            ) : null}
            {status === "in_review" ? (
              <button
                type="button"
                className="rs-btn rs-btn--primary"
                disabled={busy}
                onClick={() => void approveExport()}
              >
                Approve &amp; export
              </button>
            ) : null}
            {status === "exported" || exportReady ? (
              <a
                href={`/api/projects/${props.projectId}/export`}
                className="rs-btn rs-btn--primary"
              >
                Download zip
              </a>
            ) : null}
          </div>
        </div>

        {note ? (
          <p className={noteDanger ? "rs-note rs-note--danger" : "rs-note"}>{note}</p>
        ) : null}

        {showUpload ? (
          <div className="rs-upload">
            <div
              className="rs-dropzone"
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
              <p className="rs-kicker">Source document</p>
              <h3 className="rs-dropzone__title">
                {documentId ? "PDF ready — replace anytime" : "Drop the results PDF"}
              </h3>
              <p className="rs-dropzone__hint">
                Private storage · 150 MB / 250 pages max
                {documentId && pageCount != null ? ` · current pack ${pageCount} pages` : ""}
              </p>
              <label
                className="rs-btn rs-btn--ghost"
                style={{
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
                {busy ? "Uploading…" : documentId ? "Replace PDF" : "Choose PDF"}
              </label>
            </div>
          </div>
        ) : null}
      </div>

      {status === "extraction_failed" ? (
        <section className="rs-sheet rs-sheet--alert">
          <h2 className="rs-section-title">Extraction failed</h2>
          <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>
            {extraction?.error ??
              "The worker could not convert this PDF. Fix the worker and retry the pipeline."}
          </p>
          <div className="rs-row">
            {canRun ? (
              <button
                type="button"
                className="rs-btn rs-btn--primary"
                disabled={busy}
                onClick={() => void startPipeline()}
              >
                Retry pipeline
              </button>
            ) : null}
            <button
              type="button"
              className="rs-btn rs-btn--ghost"
              disabled={busy}
              onClick={() => void startOver()}
            >
              Start over
            </button>
          </div>
          <p className="rs-muted" style={{ fontSize: 13, margin: 0 }}>
            Start over clears the failed run so you can upload a new PDF or re-run after the worker
            is healthy.
          </p>
        </section>
      ) : null}

      {extracting && waitStats ? (
        <BusyWaitSheet
          title="Extraction in progress"
          body={
            <>
              Docling is reading the PDF on the worker. First convert after deploy can take longer
              while models load. Typically about 2–3 minutes for a {pageCount ?? "multi"}-page
              results pack.
            </>
          }
          elapsedSec={waitStats.elapsedSec}
          remainingLabel={formatSoftRemaining(waitStats.remainingSec, waitStats.overdue)}
          overdue={waitStats.overdue}
          pct={waitStats.pct}
          third={{
            label: "Pages",
            value:
              waitStats.totalPages != null
                ? `${waitStats.pagesDone} / ${waitStats.totalPages}`
                : pageCount != null
                  ? `0 / ${pageCount}`
                  : "—",
          }}
          footer={
            waitStats.overdue
              ? "Still working — large or OCR-heavy PDFs can overrun the usual window."
              : "Nothing to click right now — waiting on extraction."
          }
        />
      ) : null}

      {status === "dna_detecting" && waitStats ? (
        <BusyWaitSheet
          title="Measuring design DNA"
          body={
            <>
              Palette, type, and table treatment are being derived from the PDF. Usually about{" "}
              <strong>1–2 minutes</strong> — leave this tab open.
            </>
          }
          elapsedSec={waitStats.elapsedSec}
          remainingLabel={formatSoftRemaining(waitStats.remainingSec, waitStats.overdue)}
          overdue={waitStats.overdue}
          pct={waitStats.pct}
          third={{ label: "Typical", value: "~1.5 min", compact: true }}
          footer={
            waitStats.overdue
              ? "Still working — vision measurement can overrun on dense packs."
              : "Nothing to click right now — waiting on design DNA."
          }
        />
      ) : null}

      {status === "dna_review" ? (
        <section className="rs-sheet rs-fade-up-delay">
          <h2 className="rs-section-title">Review design DNA</h2>
          <p className="rs-muted" style={{ fontSize: 14, marginTop: 0 }}>
            Measured visual identity from the PDF (palette, type, table treatment). Approve only if
            it looks faithful — the prototype is constrained by it.
          </p>
          {dnaError ? (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
              Could not load DNA: {dnaError}
            </p>
          ) : null}
          {!dna && !dnaError ? (
            <p className="rs-muted" style={{ fontSize: 13, margin: 0 }}>
              Loading measured DNA…
            </p>
          ) : null}
          {dna ? (
            <div className="rs-stack">
              <div className="rs-stat-row">
                <div>
                  <div className="rs-stat-label">Confidence</div>
                  <div className="rs-stat-value">
                    {dna.confidence != null ? `${Math.round(dna.confidence * 100)}%` : "—"}
                  </div>
                </div>
                <div>
                  <div className="rs-stat-label">Theme</div>
                  <div className="rs-stat-value" style={{ fontSize: "1.15rem" }}>
                    {dna.theme.mode ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="rs-stat-label">Revision</div>
                  <div className="rs-stat-value">v{dna.revision}</div>
                </div>
              </div>
              {dna.theme.rationale ? (
                <p className="rs-muted" style={{ fontSize: 13, margin: 0 }}>
                  {dna.theme.rationale}
                </p>
              ) : null}
              <div>
                <div className="rs-stat-label" style={{ marginBottom: 8 }}>
                  Palette roles
                </div>
                <div className="rs-swatches">
                  {dna.roles.map((r) => (
                    <div key={r.role} className="rs-swatch">
                      <div
                        title={r.hex}
                        className="rs-swatch__chip"
                        style={{ background: r.hex }}
                      />
                      <div style={{ color: "var(--ink)", fontWeight: 600 }}>{r.role}</div>
                      <div
                        style={{
                          color: "var(--ink-2)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {r.hex}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rs-meta-grid">
                <div>
                  <span className="rs-muted">Heading face · </span>
                  {dna.type.heading ?? "—"}
                </div>
                <div>
                  <span className="rs-muted">Body face · </span>
                  {dna.type.body ?? "—"}
                </div>
                {dna.type.headingTreatment ? (
                  <div>
                    <span className="rs-muted">Heading treatment · </span>
                    {dna.type.headingTreatment.case ?? "?"} / weight{" "}
                    {dna.type.headingTreatment.weight ?? "?"} /{" "}
                    {dna.type.headingTreatment.color ?? "?"}
                  </div>
                ) : null}
                {dna.tableStyle.headerBg ? (
                  <div>
                    <span className="rs-muted">Table header · </span>
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
                    <span className="rs-muted">Tone · </span>
                    {dna.toneWords.join(", ")}
                  </div>
                ) : null}
                {dna.componentIds.length ? (
                  <div>
                    <span className="rs-muted">Components · </span>
                    {dna.componentIds.join(", ")}
                  </div>
                ) : null}
              </div>
              {dna.flags.length ? (
                <div>
                  <div className="rs-stat-label" style={{ marginBottom: 6 }}>
                    Confidence flags
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 12,
                      color: "var(--ink-2)",
                    }}
                  >
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
                className="rs-tiny"
                style={{ color: "var(--signal)" }}
              >
                Open full DNA JSON
              </a>
            </div>
          ) : null}
          <button
            type="button"
            className="rs-btn rs-btn--primary"
            disabled={busy || (!dna && !dnaError)}
            onClick={() => void approveDna()}
          >
            Approve design DNA
          </button>
        </section>
      ) : null}

      {status === "prototype_generating" && waitStats ? (
        <BusyWaitSheet
          title="Generating prototype"
          body={
            <>
              Building the DNA layout shell (opus), then injecting full financial tables. Usually{" "}
              <strong>3–6 minutes</strong> — leave this tab open. When it finishes, status becomes{" "}
              <strong>in review</strong> and you can refine or approve.
            </>
          }
          elapsedSec={waitStats.elapsedSec}
          remainingLabel={formatSoftRemaining(waitStats.remainingSec, waitStats.overdue)}
          overdue={waitStats.overdue}
          pct={waitStats.pct}
          third={{ label: "Typical", value: "3–6 min", compact: true }}
          footer={
            waitStats.overdue
              ? "Still working — long runs and a single automatic retry can exceed the typical window."
              : "Nothing to click right now — waiting on generation."
          }
        />
      ) : null}

      {status === "in_review" || status === "blueprint_proposed" ? (
        <section className="rs-sheet rs-fade-up-delay">
          <h2 className="rs-section-title">Prototype preview</h2>
          <p className="rs-muted" style={{ fontSize: 14, marginTop: 0 }}>
            Interactive HTML generated from the approved DNA. Compare it to the source PDF
            look-and-feel, then refine or approve.
          </p>
          {prototypeError ? (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
              Could not load prototype: {prototypeError}
            </p>
          ) : null}
          {!prototype && !prototypeError ? (
            <p className="rs-muted" style={{ fontSize: 13, margin: 0 }}>
              Loading prototype…
            </p>
          ) : null}
          {prototype ? (
            <>
              <div className="rs-preview-toolbar">
                <span>
                  v{prototype.versionNumber} · {prototype.refinementMode}
                  {prototype.sizeBytes != null
                    ? ` · ${Math.round(prototype.sizeBytes / 1024)} KB`
                    : ""}
                </span>
                <div className="rs-viewport" role="group" aria-label="Preview width">
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
                      aria-pressed={previewWidth === w}
                      onClick={() => setPreviewWidth(w)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <a
                  href={`${prototype.previewUrl}?v=${prototype.versionNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rs-tiny"
                  style={{ color: "var(--signal)", marginLeft: "auto" }}
                >
                  Open in new tab
                </a>
              </div>
              <div className="rs-preview-frame">
                <iframe
                  key={prototype.versionId}
                  title={`Prototype v${prototype.versionNumber}`}
                  src={`${prototype.previewUrl}?v=${prototype.versionNumber}`}
                  sandbox="allow-scripts"
                  style={{
                    width: previewWidth === "full" ? "100%" : previewWidth,
                  }}
                />
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {status === "in_review" ? (
        <section className="rs-sheet">
          <h2 className="rs-section-title">Refine prototype</h2>
          <p className="rs-muted" style={{ fontSize: 14, marginTop: 0 }}>
            Patch-first edits against the current prototype. Numbers cannot change — describe
            layout, styling, or non-numeric copy only. When it looks right, Approve &amp; export.
          </p>
          <textarea
            value={refinePrompt}
            onChange={(e) => setRefinePrompt(e.target.value)}
            placeholder="e.g. Make the masthead tighter and move KPIs into a single horizontal band."
            rows={3}
            disabled={busy}
            className="rs-field"
          />
          <label className="rs-check">
            <input
              type="checkbox"
              checked={forceRegen}
              disabled={busy}
              onChange={(e) => setForceRegen(e.target.checked)}
            />
            Force full regen (slow / expensive — only if patch cannot express the change)
          </label>
          <div className="rs-row">
            <button
              type="button"
              className="rs-btn rs-btn--primary"
              disabled={busy || !refinePrompt.trim()}
              onClick={() => {
                const prompt = refinePrompt.trim();
                if (!prompt) return;
                const fromVersion = prototype?.versionNumber ?? 0;
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
                ).then((ok) => {
                  if (!ok) return;
                  setNote(
                    `Refine accepted from v${fromVersion}. Patching now — wait for the preview version to bump (do not click Start over).`,
                  );
                });
              }}
            >
              {forceRegen ? "Rebuild prototype" : "Send refine"}
            </button>
            <button
              type="button"
              className="rs-btn rs-btn--ghost"
              disabled={busy}
              onClick={() => void approveExport()}
            >
              Approve &amp; export
            </button>
          </div>
        </section>
      ) : null}

      {status === "exporting" ? (
        <section className="rs-sheet" aria-live="polite">
          <h2 className="rs-section-title">Packaging export</h2>
          <p className="rs-muted" style={{ fontSize: 14, margin: 0 }}>
            Building the multi-page Results Studio site (home, commentary, statements, notes,
            administration, downloads). Download appears when status becomes{" "}
            <strong>exported</strong>.
          </p>
        </section>
      ) : null}

      {status === "exported" || exportReady ? (
        <section className="rs-sheet">
          <h2 className="rs-section-title">Export ready</h2>
          <p className="rs-muted" style={{ fontSize: 14, margin: 0 }}>
            Download the zip, unzip it, and open <code>index.html</code> in a browser to navigate
            the multi-page site (sticky Financials nav, breadcrumbs, previous/next).
            {exportInfo?.fileCount ? (
              <>
                {" "}
                Bundle has <strong>{exportInfo.fileCount}</strong> file
                {exportInfo.fileCount === 1 ? "" : "s"}
                {exportInfo.mode ? <> · mode <code>{exportInfo.mode}</code></> : null}.
              </>
            ) : null}
          </p>
          {exportInfo?.files?.length ? (
            <details style={{ fontSize: 13 }}>
              <summary>Files in export</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {exportInfo.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <a
            href={`/api/projects/${props.projectId}/export`}
            className="rs-btn rs-btn--primary"
            style={{ justifySelf: "start" }}
          >
            Download microsite zip
          </a>
        </section>
      ) : null}

      <details className="rs-timeline">
        <summary>Run timeline · {events.length} events</summary>
        {events.length === 0 ? (
          <p className="rs-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            {extracting
              ? "Extraction is running. Timeline events will appear as steps complete."
              : "No events yet. Upload a PDF and run the pipeline to see progress stream in."}
          </p>
        ) : (
          <ul>
            {events.map((e) => (
              <li key={e.id}>
                <time dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleTimeString()}
                </time>
                <span>{e.type}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function BusyWaitSheet(props: {
  title: string;
  body: ReactNode;
  elapsedSec: number;
  remainingLabel: string;
  overdue: boolean;
  pct: number;
  third: { label: string; value: ReactNode; compact?: boolean };
  footer: string;
}) {
  return (
    <section className="rs-sheet" aria-live="polite">
      <h2 className="rs-section-title">{props.title}</h2>
      <p className="rs-muted" style={{ fontSize: 14, margin: 0 }}>
        {props.body}
      </p>
      <div className="rs-stat-row">
        <div>
          <div className="rs-stat-label">Elapsed</div>
          <div className="rs-stat-value">{formatDuration(props.elapsedSec)}</div>
        </div>
        <div>
          <div className="rs-stat-label">{props.overdue ? "Estimate" : "Est. remaining"}</div>
          <div
            className="rs-stat-value"
            style={{ fontSize: props.overdue || props.remainingLabel.length > 8 ? "1.15rem" : undefined }}
          >
            {props.remainingLabel}
          </div>
        </div>
        <div>
          <div className="rs-stat-label">{props.third.label}</div>
          <div
            className="rs-stat-value"
            style={props.third.compact ? { fontSize: "1.15rem" } : undefined}
          >
            {props.third.value}
          </div>
        </div>
      </div>
      <div className="rs-progress rs-progress--live">
        <div
          className="rs-progress__bar"
          style={{ width: `${Math.round(props.pct * 100)}%` }}
        />
      </div>
      <p className="rs-muted" style={{ fontSize: 13, margin: 0 }}>
        {props.footer}
      </p>
    </section>
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
    in_review: 3,
    // Legacy mid-pipeline statuses collapse onto Prototype / Export.
    blueprint_extracting: 3,
    blueprint_proposed: 3,
    locked: 3,
    mapping: 3,
    qa_running: 4,
    qa_review: 4,
    exporting: 4,
    exported: 4,
  };
  return map[status] ?? 0;
}
