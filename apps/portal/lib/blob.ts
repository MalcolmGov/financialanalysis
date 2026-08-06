import { env } from "./env";

/**
 * Blob mediation. ALL client PDFs and artifacts are private. No raw Blob URL
 * ever reaches a browser — reads flow through the authz proxy route. In
 * MOCK_BLOB mode we persist to a local .artifacts/ dir so the pipeline runs
 * without cloud credentials.
 *
 * Node builtins are imported dynamically (never at module scope): this module
 * is reachable from the Workflow graph, whose sandbox forbids static node:*
 * imports. These functions only ever execute inside "use step" bodies, which
 * have full Node access at runtime.
 */

export async function sha256(buf: Buffer | Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buf).digest("hex");
}

async function mockRoot() {
  const { join } = await import("node:path");
  return join(process.cwd(), ".artifacts");
}

export async function putPrivate(
  path: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<{ blob_path: string; sha256: string; bytes: number }> {
  const buf = Buffer.from(typeof body === "string" ? Buffer.from(body) : body);
  const digest = await sha256(buf);
  if (env.MOCK_BLOB) {
    const { promises: fs } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const dest = join(await mockRoot(), path);
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    return { blob_path: path, sha256: digest, bytes: buf.byteLength };
  }
  const { put } = await import("@vercel/blob");
  // Deterministic pathnames are intentional (ArtifactRefs / preview URLs).
  // Workflow steps retry after partial success, so overwrite must be allowed —
  // otherwise the second put fails with "blob already exists" after a long
  // Claude generation (seen on generatePrototypeArtifact).
  const res = await put(path, buf, {
    access: "public", // Store is private; access is mediated by the /api/blob proxy route.
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return { blob_path: res.pathname, sha256: digest, bytes: buf.byteLength };
}

export async function getPrivate(path: string): Promise<Buffer> {
  if (env.MOCK_BLOB) {
    const { promises: fs } = await import("node:fs");
    const { join } = await import("node:path");
    return fs.readFile(join(await mockRoot(), path));
  }
  const { head } = await import("@vercel/blob");
  const meta = await head(path, { token: env.BLOB_READ_WRITE_TOKEN });
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Short-TTL signed URL for the worker's single-use source download. */
export async function signedSourceUrl(path: string): Promise<string> {
  if (env.MOCK_BLOB) {
    const { join } = await import("node:path");
    return `file://${join(await mockRoot(), path)}`;
  }
  const { head } = await import("@vercel/blob");
  const meta = await head(path, { token: env.BLOB_READ_WRITE_TOKEN });
  return meta.url;
}
