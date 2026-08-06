import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { UPLOAD_LIMITS, type UploadRecord } from "@rs/contracts";
import { requireOperator } from "../../../../lib/authz";
import { getPrivate, sha256 } from "../../../../lib/blob";
import { db, schema } from "../../../../lib/db";
import { env } from "../../../../lib/env";

/**
 * Server-side structural validation. An unvalidated blob can never enter the
 * pipeline: we check magic bytes, encryption and page count and reject with
 * typed ExtractionError codes before writing a documents row.
 */
export async function POST(request: Request): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { projectId, blobPath } = (await request.json()) as {
    projectId: string;
    blobPath: string;
  };
  if (!projectId || !blobPath) {
    return Response.json({ error: "projectId and blobPath required" }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await getPrivate(blobPath);
  } catch {
    return typedError("SOURCE_FETCH_FAILED", "uploaded blob not found");
  }

  if (bytes.byteLength > UPLOAD_LIMITS.max_bytes) {
    return typedError("SIZE_LIMIT_EXCEEDED", `> ${UPLOAD_LIMITS.max_bytes} bytes`);
  }
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return typedError("NOT_A_PDF", "missing %PDF- magic bytes");
  }

  let pageCount: number;
  let title = "";
  let producer = "";
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.isEncrypted) return typedError("PDF_ENCRYPTED", "encrypted PDFs are not accepted");
    pageCount = pdf.getPageCount();
    title = safe(() => pdf.getTitle());
    producer = safe(() => pdf.getProducer());
  } catch {
    return typedError("PDF_CORRUPT", "could not parse PDF structure");
  }
  if (pageCount > UPLOAD_LIMITS.max_pages) {
    return typedError("PAGE_LIMIT_EXCEEDED", `${pageCount} > ${UPLOAD_LIMITS.max_pages} pages`);
  }

  const digest = await sha256(bytes);
  const record: UploadRecord = {
    schema_version: "1.0",
    upload_id: `upl_${digest.slice(0, 16)}`,
    org_id: "",
    project_id: projectId,
    blob_path: blobPath,
    sha256: digest,
    size_bytes: bytes.byteLength,
    page_count: pageCount,
    pdf_meta: { title, producer, created: "", encrypted: false },
    status: "validated",
    uploaded_by: operator.id,
    uploaded_at: new Date().toISOString(),
  };

  if (!env.MOCK_BLOB) {
    const [doc] = await db()
      .insert(schema.documents)
      .values({
        projectId,
        blobPath,
        sha256: digest,
        sizeBytes: bytes.byteLength,
        pageCount,
        pdfMeta: record.pdf_meta,
      })
      .returning();
    await db()
      .update(schema.projects)
      .set({ currentDocumentId: doc.id, status: "uploaded", updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
  }

  return Response.json(record);
}

function safe(fn: () => string | undefined): string {
  try {
    return fn() ?? "";
  } catch {
    return "";
  }
}

function typedError(code: string, message: string) {
  return Response.json({ error: { code, message } }, { status: 422 });
}
