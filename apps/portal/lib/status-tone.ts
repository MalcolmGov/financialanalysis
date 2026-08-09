/** Map pipeline / project status → operator status-chip modifier. */
export function statusToneClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("fail") || s.includes("error")) return "rs-status--danger";
  if (
    s === "exported" ||
    s.includes("publish") ||
    s.includes("complete") ||
    s.includes("succeeded")
  ) {
    return "rs-status--done";
  }
  if (
    s.includes("review") ||
    s.includes("ready") ||
    s.includes("blueprint") ||
    s === "uploaded"
  ) {
    return "rs-status--review";
  }
  if (
    s.includes("extract") ||
    s.includes("detect") ||
    s.includes("generat") ||
    s.includes("exporting") ||
    s.includes("running") ||
    s.includes("upload")
  ) {
    return "rs-status--live";
  }
  if (s.includes("warn") || s.includes("stale")) return "rs-status--warn";
  return "rs-status--idle";
}
