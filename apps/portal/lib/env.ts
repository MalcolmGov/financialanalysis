/**
 * Lazy env access. Never assert at module load — the app must BUILD without
 * real credentials. Call these getters inside request handlers / steps only.
 */
/** Strip accidental shell/UI wrapping quotes from Railway-pasted secrets. */
function clean(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return clean(v);
}
function opt(name: string, fallback = ""): string {
  const v = process.env[name];
  return v == null || v === "" ? fallback : clean(v);
}

export const env = {
  get DATABASE_URL() {
    return req("DATABASE_URL");
  },
  get BLOB_READ_WRITE_TOKEN() {
    return req("BLOB_READ_WRITE_TOKEN");
  },
  get ANTHROPIC_API_KEY() {
    return req("ANTHROPIC_API_KEY");
  },
  get WORKER_BASE_URL() {
    return opt("WORKER_BASE_URL", "http://localhost:8000");
  },
  get WORKER_SERVICE_TOKEN() {
    return req("WORKER_SERVICE_TOKEN");
  },
  get WEBHOOK_HMAC_KEY() {
    return req("WEBHOOK_HMAC_KEY");
  },
  get APP_BASE_URL() {
    return opt("APP_BASE_URL", "http://localhost:3000");
  },
  get OPERATOR_EMAILS(): string[] {
    return opt("OPERATOR_EMAILS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Dev escape hatch: skip real Blob I/O so the pipeline runs without cloud creds. */
  get MOCK_BLOB() {
    return process.env.MOCK_BLOB === "1";
  },
};
