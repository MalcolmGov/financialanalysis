import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { UPLOAD_LIMITS } from "@rs/contracts";
import { requireOperator } from "../../../../lib/authz";
import { env } from "../../../../lib/env";

/**
 * Issues a one-shot, pathname-scoped client-upload token so the browser streams
 * the PDF straight into the PRIVATE Blob store — auth, content-type and the
 * 150 MB cap are enforced before a byte moves. Structural validation follows in
 * /complete.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.endsWith(".pdf")) throw new Error("only .pdf uploads are permitted");
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: UPLOAD_LIMITS.max_bytes,
          // Re-uploads of the same filename (start-over / retry) must not 409.
          addRandomSuffix: true,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async () => {
        // Structural validation happens in /complete, gated on operator auth.
      },
    });
    return Response.json(json);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
