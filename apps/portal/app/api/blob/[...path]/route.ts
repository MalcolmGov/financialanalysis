import { logAccess, requireOperator } from "../../../../lib/authz";
import { getPrivate } from "../../../../lib/blob";

/**
 * The ONLY path by which artifact bytes reach a browser. Operator-authed,
 * access-logged, no-store. No raw Blob URL is ever exposed; prototypes render
 * through this route into a sandboxed preview iframe (allow-scripts +
 * allow-same-origin so CSP 'self' can load relative assets/site.js).
 *
 * Multipage site drafts reference relative assets (assets/brand/*, fonts,
 * site.js). CSP must allow same-origin subresources — not only data: URIs —
 * or logos/fonts/runtime appear broken in console preview.
 */
function contentTypeFor(blobPath: string): string {
  const lower = blobPath.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

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
  const isPdf = blobPath.toLowerCase().endsWith(".pdf");
  const contentType = contentTypeFor(blobPath);

  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, no-store",
  };
  // HTML prototypes / site drafts: zero-egress CSP. Same-origin ('self') is
  // required so relative assets/brand, fonts, and assets/site.js load in the
  // preview iframe. PDFs use the browser viewer — omit CSP so native PDF
  // chrome (toolbar / fonts) can render in the compare iframe.
  if (!isPdf) {
    headers["content-security-policy"] = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  } else {
    headers["content-disposition"] = "inline";
  }

  return new Response(new Uint8Array(bytes), { headers });
}
