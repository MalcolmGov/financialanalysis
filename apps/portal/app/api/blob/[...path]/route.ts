import { logAccess, requireOperator } from "../../../../lib/authz";
import { getPrivate } from "../../../../lib/blob";

/**
 * The ONLY path by which artifact bytes reach a browser. Operator-authed,
 * access-logged, no-store. No raw Blob URL is ever exposed; prototypes render
 * through this route into a sandboxed, cookie-less preview iframe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }
  const { path } = await params;
  const blobPath = path.join("/");
  await logAccess("operator", operator.id, "blob.read", blobPath);

  let bytes: Buffer;
  try {
    bytes = await getPrivate(blobPath);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const contentType = blobPath.endsWith(".html")
    ? "text/html; charset=utf-8"
    : blobPath.endsWith(".json")
      ? "application/json"
      : blobPath.endsWith(".png")
        ? "image/png"
        : blobPath.endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
      // Zero-egress posture for rendered prototypes (MNPI cannot exfiltrate).
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:",
    },
  });
}
