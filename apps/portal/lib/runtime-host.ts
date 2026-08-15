/**
 * Classify which operator host this request landed on.
 *
 * Daily extract / rebuild / export run on the Railway portal. Vercel clones
 * of the UI share auth and Blob, but the worker is Railway-internal — so
 * pipeline work from Vercel looks “broken” unless we say so up front.
 */
export type OperatorHostKind = "pipeline" | "ui-preview" | "local";

export type OperatorHostCopy = {
  kind: OperatorHostKind;
  label: string;
  hint: string;
};

export function classifyHost(host: string): OperatorHostKind {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "::1") return "local";
  if (h.endsWith(".vercel.app") || h === "vercel.app") return "ui-preview";
  return "pipeline";
}

export function hostOperatorCopy(kind: OperatorHostKind): OperatorHostCopy {
  if (kind === "ui-preview") {
    return {
      kind,
      label: "UI only · Vercel",
      hint: "Sign-in works here. Extraction and rebuild run on the Railway pipeline host — use that URL for daily production.",
    };
  }
  if (kind === "local") {
    return {
      kind,
      label: "Local",
      hint: "Local portal. Worker defaults to localhost:8000 unless WORKER_BASE_URL is set.",
    };
  }
  return {
    kind,
    label: "Railway pipeline",
    hint: "Daily production host for extract, rebuild, sign-off, and export.",
  };
}

export const RAILWAY_PIPELINE_URL = "https://portal-production-518a.up.railway.app";
